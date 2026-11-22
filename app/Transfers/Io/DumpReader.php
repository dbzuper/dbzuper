<?php

namespace App\Transfers\Io;

use InflateContext;
use RuntimeException;

/** Streaming dump file reader. Detects gzip by magic bytes and strips a leading UTF-8 BOM. */
class DumpReader
{
    private const FILE_CHUNK = 8_192;

    /** @var resource */
    private $handle;

    private bool $gzip;

    private ?InflateContext $inflate = null;

    private string $pending = '';

    private int $offset = 0;

    private bool $eof = false;

    private bool $first = true;

    private int $position = 0;

    public function __construct(private readonly string $path)
    {
        $handle = @fopen($path, 'rb');
        if ($handle === false) {
            throw new RuntimeException("Cannot open {$path} for reading.");
        }
        $this->handle = $handle;

        $magic = (string) fread($handle, 2);
        rewind($handle);
        $this->gzip = $magic === "\x1f\x8b";

        if ($this->gzip) {
            $this->inflate = $this->newInflate();
        }
    }

    public function __destruct()
    {
        if (is_resource($this->handle)) {
            fclose($this->handle);
        }
    }

    /** Releases the file now rather than when the reader is collected (a file still open can't be deleted on Windows). */
    public function close(): void
    {
        if (is_resource($this->handle)) {
            fclose($this->handle);
        }
    }

    public function isGzip(): bool
    {
        return $this->gzip;
    }

    /** File bytes consumed so far (compressed size for gzip files). */
    public function position(): int
    {
        return $this->position;
    }

    /** Next chunk of decompressed text (about $bytes long), or null at end of file. Never returns ''. */
    public function read(int $bytes = 4_194_304): ?string
    {
        $bytes = max(1, $bytes);

        while (true) {
            // The first chunk must hold enough bytes to recognise a BOM.
            $this->fill($this->first ? max($bytes, 3) : $bytes);

            if ($this->available() === 0) {
                return null;
            }

            if ($this->first) {
                $this->first = false;
                if (substr($this->pending, $this->offset, 3) === "\xEF\xBB\xBF") {
                    $this->offset += 3;

                    continue; // a BOM-only chunk leaves nothing to return yet
                }
            }

            $chunk = substr($this->pending, $this->offset, $bytes);
            $this->offset += strlen($chunk);

            return $chunk;
        }
    }

    private function available(): int
    {
        return strlen($this->pending) - $this->offset;
    }

    private function fill(int $want): void
    {
        if ($this->offset > 0) {
            $this->pending = (string) substr($this->pending, $this->offset);
            $this->offset = 0;
        }

        while (! $this->eof && strlen($this->pending) < $want) {
            $raw = fread($this->handle, $this->gzip ? self::FILE_CHUNK : max($want - strlen($this->pending), 1));
            if ($raw === false) {
                throw new RuntimeException("Cannot read from {$this->path}.");
            }

            if ($raw === '') {
                if (feof($this->handle)) {
                    $this->eof = true;
                    $this->finish();
                }

                continue;
            }

            $this->position += strlen($raw);

            if ($this->gzip) {
                $this->inflateChunk($raw);
            } else {
                $this->pending .= $raw;
            }
        }
    }

    /** Inflates raw bytes, moving on to the next gzip member whenever one ends. */
    private function inflateChunk(string $raw): void
    {
        while ($raw !== '') {
            if ($this->inflate === null) {
                // Between members: NUL padding is ignored, anything else starts a new member.
                if (trim($raw, "\0") === '') {
                    return;
                }
                $this->inflate = $this->newInflate();
            }

            $before = inflate_get_read_len($this->inflate);
            $out = @inflate_add($this->inflate, $raw, ZLIB_SYNC_FLUSH);
            if ($out === false) {
                throw new RuntimeException("{$this->path} is not a valid gzip file (corrupt data).");
            }
            $this->pending .= $out;

            if (inflate_get_status($this->inflate) !== ZLIB_STREAM_END) {
                return;
            }

            $consumed = inflate_get_read_len($this->inflate) - $before;
            $raw = (string) substr($raw, $consumed);
            $this->inflate = null;
        }
    }

    private function newInflate(): InflateContext
    {
        $inflate = inflate_init(ZLIB_ENCODING_GZIP);
        if ($inflate === false) {
            throw new RuntimeException('Cannot start gzip decompression.');
        }

        return $inflate;
    }

    private function finish(): void
    {
        if ($this->gzip && $this->inflate !== null && inflate_get_status($this->inflate) !== ZLIB_STREAM_END) {
            throw new RuntimeException("{$this->path} is a truncated gzip file.");
        }
    }
}
