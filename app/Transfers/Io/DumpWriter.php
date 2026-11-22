<?php

namespace App\Transfers\Io;

use DeflateContext;
use RuntimeException;

/** Buffered, optionally gzip-compressed dump file writer. */
class DumpWriter
{
    private const FLUSH_AT = 1_048_576;

    /** @var resource|null */
    private $handle;

    private ?DeflateContext $deflate = null;

    private string $buffer = '';

    private int $written = 0;

    public function __construct(private readonly string $path, bool $gzip)
    {
        $handle = @fopen($path, 'wb');
        if ($handle === false) {
            throw new RuntimeException("Cannot open {$path} for writing.");
        }
        $this->handle = $handle;

        if ($gzip) {
            $deflate = deflate_init(ZLIB_ENCODING_GZIP, ['level' => 6]);
            if ($deflate === false) {
                fclose($handle);
                throw new RuntimeException('Cannot start gzip compression.');
            }
            $this->deflate = $deflate;
        }
    }

    public function write(string $s): void
    {
        $this->written += strlen($s);

        if ($this->deflate !== null) {
            $s = $this->deflate($s, ZLIB_NO_FLUSH);
        }

        $this->buffer .= $s;
        if (strlen($this->buffer) >= self::FLUSH_AT) {
            $this->flush();
        }
    }

    /** Uncompressed bytes written so far. */
    public function bytesWritten(): int
    {
        return $this->written;
    }

    /** Finishes the file and returns its final size in bytes. */
    public function close(): int
    {
        if ($this->handle === null) {
            return (int) @filesize($this->path);
        }

        if ($this->deflate !== null) {
            $this->buffer .= $this->deflate('', ZLIB_FINISH);
            $this->deflate = null;
        }
        $this->flush();
        fclose($this->handle);
        $this->handle = null;
        clearstatcache(true, $this->path);

        return (int) filesize($this->path);
    }

    /** Closes the file and deletes it. */
    public function abort(): void
    {
        if ($this->handle !== null) {
            fclose($this->handle);
            $this->handle = null;
        }
        $this->deflate = null;
        $this->buffer = '';
        if (file_exists($this->path)) {
            @unlink($this->path);
        }
    }

    private function deflate(string $data, int $flush): string
    {
        $out = deflate_add($this->deflate, $data, $flush);
        if ($out === false) {
            throw new RuntimeException('Gzip compression failed.');
        }

        return $out;
    }

    private function flush(): void
    {
        if ($this->buffer === '') {
            return;
        }
        if (fwrite($this->handle, $this->buffer) !== strlen($this->buffer)) {
            throw new RuntimeException("Cannot write to {$this->path} (disk full?).");
        }
        $this->buffer = '';
    }
}
