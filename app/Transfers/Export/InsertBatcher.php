<?php

namespace App\Transfers\Export;

use App\Transfers\Io\DumpWriter;

/** Groups row tuples into multi-row INSERT statements capped at a byte size. */
final class InsertBatcher
{
    private string $buffer = '';

    /** Bytes of tuples (and separators) in the pending statement; the fixed prefix is not counted. */
    private int $size = 0;

    public function __construct(
        private readonly DumpWriter $writer,
        private readonly string $insertPrefix,
        private readonly int $maxBytes = 1_000_000,
    ) {}

    /** @param string $tuple e.g. "(1,'x')" */
    public function add(string $tuple): void
    {
        $len = strlen($tuple);

        if ($this->size > 0 && $this->size + 2 + $len > $this->maxBytes) {
            $this->flush();
        }

        if ($this->size === 0) {
            $this->buffer = $this->insertPrefix."\n".$tuple;
            $this->size = $len;
        } else {
            $this->buffer .= ",\n".$tuple;
            $this->size += 2 + $len;
        }

        // An oversized tuple goes out alone rather than being joined by the next one.
        if ($this->size > $this->maxBytes) {
            $this->flush();
        }
    }

    public function flush(): void
    {
        if ($this->size === 0) {
            return;
        }

        $this->writer->write($this->buffer.";\n");
        $this->buffer = '';
        $this->size = 0;
    }
}
