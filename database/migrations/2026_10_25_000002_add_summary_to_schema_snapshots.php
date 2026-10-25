<?php

use App\Database\Schema\SnapshotSummary;
use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Schema;

/**
 * Counts and a small preview graph per snapshot, so the connections index never decodes full payloads.
 *
 * Depends on live application code: SnapshotSummary::of. It must keep accepting a stored payload and returning
 * the three columns for as long as this migration can run on an older install; if it ever changes shape, inline
 * a frozen copy here instead.
 */
return new class extends Migration
{
    public function up(): void
    {
        Schema::table('schema_snapshots', function (Blueprint $table) {
            $table->unsignedInteger('table_count')->nullable();
            $table->unsignedInteger('view_count')->nullable();
            $table->json('preview')->nullable();
        });

        self::backfill();
    }

    public function down(): void
    {
        Schema::table('schema_snapshots', function (Blueprint $table) {
            $table->dropColumn(['table_count', 'view_count', 'preview']);
        });
    }

    /**
     * Fills the latest snapshot of each connection; older ones are never read for the summary and stay null. Small
     * chunks, since each row carries a full payload.
     */
    public static function backfill(): void
    {
        $latest = DB::table('schema_snapshots')->selectRaw('max(id)')->groupBy('connection_id');

        DB::table('schema_snapshots')
            ->whereNull('table_count')
            ->whereIn('id', $latest)
            ->select('id', 'payload')
            ->chunkById(10, function ($rows) {
                foreach ($rows as $row) {
                    try {
                        $summary = SnapshotSummary::of(json_decode($row->payload, true) ?? []);
                    } catch (Throwable) {
                        // An odd payload must not break the migration; the row stays null and the card seeds a default star.
                        continue;
                    }
                    DB::table('schema_snapshots')->where('id', $row->id)->update([
                        'table_count' => $summary['table_count'],
                        'view_count' => $summary['view_count'],
                        'preview' => json_encode($summary['preview'], JSON_THROW_ON_ERROR),
                    ]);
                }
            });
    }
};
