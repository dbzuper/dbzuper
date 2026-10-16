<?php

use App\Database\Query\HistoryRecorder;
use Illuminate\Database\Migrations\Migration;
use Illuminate\Support\Facades\DB;

/**
 * History written before redaction existed stored SQL verbatim, passwords included. Every stored row is redacted with
 * its own connection's dialect (rows always have one: they cascade with their connection).
 */
return new class extends Migration
{
    public function up(): void
    {
        DB::table('query_history')
            ->join('connections', 'connections.id', '=', 'query_history.connection_id')
            ->select('query_history.id', 'query_history.sql', 'query_history.error', 'connections.driver')
            ->chunkById(500, function ($rows) {
                foreach ($rows as $row) {
                    [$sql, $error] = HistoryRecorder::redact($row->sql, $row->error, $row->driver);
                    if ($sql !== $row->sql || $error !== $row->error) {
                        DB::table('query_history')->where('id', $row->id)->update(['sql' => $sql, 'error' => $error]);
                    }
                }
            }, 'query_history.id', 'id');
    }

    public function down(): void
    {
        // The secrets are gone for good.
    }
};
