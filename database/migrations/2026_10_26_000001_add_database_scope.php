<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Schema;

/**
 * Server-level connections: a blank `connections.database` means "every database on the server". Data that describes
 * one database (snapshots, layout, pins, history) records which one; '' for connections with a fixed database.
 * 255 characters is enough for any engine's database name (MySQL 64, PostgreSQL 63) and keeps the unique indexes
 * under MySQL's key length limit.
 */
return new class extends Migration
{
    /**
     * Database names compare exactly: MySQL/MariaDB collations would otherwise treat `Shop` and `shop` (or `café` and
     * `cafe`), which are different databases on most servers, as one and mix their rows.
     */
    private function databaseColumn(Blueprint $table): void
    {
        $column = $table->string('database', 255)->default('');
        if (in_array(Schema::getConnection()->getDriverName(), ['mysql', 'mariadb'], true)) {
            $column->collation('utf8mb4_bin');
        }
    }

    public function up(): void
    {
        Schema::table('connections', function (Blueprint $table) {
            $table->string('database', 1024)->nullable()->change();
            $table->string('last_database', 255)->nullable();
        });

        Schema::table('schema_snapshots', function (Blueprint $table) {
            $this->databaseColumn($table);
            $table->index(['connection_id', 'database', 'id']);
        });

        Schema::table('query_history', function (Blueprint $table) {
            $this->databaseColumn($table);
            $table->index(['connection_id', 'database', 'id']);
        });

        // The new unique index comes first: on MySQL it then backs the foreign key the old one served.
        Schema::table('layout_positions', function (Blueprint $table) {
            $this->databaseColumn($table);
            $table->unique(['connection_id', 'database']);
        });
        Schema::table('layout_positions', function (Blueprint $table) {
            $table->dropUnique(['connection_id']);
        });

        Schema::table('pinned_tables', function (Blueprint $table) {
            $this->databaseColumn($table);
            $table->unique(['user_id', 'connection_id', 'database', 'table_name']);
        });
        Schema::table('pinned_tables', function (Blueprint $table) {
            $table->dropUnique(['user_id', 'connection_id', 'table_name']);
        });
    }

    public function down(): void
    {
        // Rows of server-level connections have no fixed-database equivalent.
        $serverLevel = fn () => DB::table('connections')->whereNull('database')->orWhere('database', '')->pluck('id');
        foreach (['schema_snapshots', 'query_history', 'layout_positions', 'pinned_tables'] as $name) {
            DB::table($name)->where('database', '<>', '')->delete();
        }
        DB::table('connections')->whereIn('id', $serverLevel())->delete();

        Schema::table('pinned_tables', function (Blueprint $table) {
            $table->unique(['user_id', 'connection_id', 'table_name']);
        });
        Schema::table('pinned_tables', function (Blueprint $table) {
            $table->dropUnique(['user_id', 'connection_id', 'database', 'table_name']);
            $table->dropColumn('database');
        });

        Schema::table('layout_positions', function (Blueprint $table) {
            $table->unique(['connection_id']);
        });
        Schema::table('layout_positions', function (Blueprint $table) {
            $table->dropUnique(['connection_id', 'database']);
            $table->dropColumn('database');
        });

        foreach (['schema_snapshots', 'query_history'] as $name) {
            Schema::table($name, function (Blueprint $table) {
                $table->dropIndex(['connection_id', 'database', 'id']);
                $table->dropColumn('database');
            });
        }

        Schema::table('connections', function (Blueprint $table) {
            $table->dropColumn('last_database');
            $table->string('database', 1024)->nullable(false)->change();
        });
    }
};
