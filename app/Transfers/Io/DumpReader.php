<?php

namespace App\Transfers\Io;

use InflateContext;
use RuntimeException;

/** Streaming dump file reader. Detects gzip by magic bytes and strips a leading UTF-8 BOM. */
class DumpReader
{
    private const FILE_CHUNK = 65_536;

    /** @var resource */
    private $handle;

    private bool $gzip;

    private ?InflateContext $inflate = null;

    private string $pending = '';

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
            $inflate = inflate_init(ZLIB_ENCODING_GZIP);
            if ($inflate === false) {
                throw new RuntimeException('Cannot start gzip decompression.');
            }
            $this->inflate = $inflate;
        }
    }

    public function __destruct()
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

        // The first chunk must hold enough bytes to recognise a BOM.
        $want = $this->first ? max($bytes, 3) : $bytes;
        $this->fill($want);

        if ($this->pending === '') {
            return null;
        }

        if ($this->first) {
            $this->first = false;
            if (str_starts_with($this->pending, "\xEF\xBB\xBF")) {
                $this->pending = substr($this->pending, 3);
                if ($this->pending === '') {
                    return $this->read($bytes);
                }
            }
        }

        $chunk = substr($this->pending, 0, $bytes);
        $this->pending = (string) substr($this->pending, strlen($chunk));

        return $chunk;
    }

    private function fill(int $want): void
    {
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

            if (! $this->gzip) {
                $this->pending .= $raw;

                continue;
            }

            $out = @inflate_add($this->inflate, $raw, ZLIB_SYNC_FLUSH);
            if ($out === false) {
                throw new RuntimeException("{$this->path} is not a valid gzip file (corrupt data).");
            }
            $this->pending .= $out;
        }
    }

    private function finish(): void
    {
        if ($this->gzip && inflate_get_status($this->inflate) !== ZLIB_STREAM_END) {
            throw new RuntimeException("{$this->path} is a truncated gzip file.");
        }
    }
}
