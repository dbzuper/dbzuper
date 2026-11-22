<?php

namespace App\Transfers\Export;

use App\Transfers\Io\DumpWriter;
use App\Transfers\TransferProgress;
use Illuminate\Database\Connection;

interface BuiltinExporter
{
    public function export(Connection $db, ExportOptions $o, DumpWriter $w, TransferProgress $p): void;

    /** @return list<string> what this exporter leaves out (listed in the dump header) */
    public function gaps(): array;
}
