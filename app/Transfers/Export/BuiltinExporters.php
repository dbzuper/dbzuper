<?php

namespace App\Transfers\Export;

use App\Enums\DriverName;
use LogicException;

/** Registry of built-in exporters keyed by DriverName value. */
final class BuiltinExporters
{
    /** @param array<string, class-string<BuiltinExporter>> $map */
    public function __construct(private readonly array $map = []) {}

    public function for(DriverName $driver): BuiltinExporter
    {
        $class = $this->map[$driver->value] ?? throw new LogicException("No built-in exporter for {$driver->value}");

        return app($class);
    }
}
