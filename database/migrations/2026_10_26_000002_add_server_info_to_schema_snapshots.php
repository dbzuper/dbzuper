<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\Schema;

/** The server's version, login, encoding and size as read with each snapshot (null when they couldn't be read). */
return new class extends Migration
{
    public function up(): void
    {
        Schema::table('schema_snapshots', function (Blueprint $table) {
            $table->json('server_info')->nullable();
        });
    }

    public function down(): void
    {
        Schema::table('schema_snapshots', function (Blueprint $table) {
            $table->dropColumn('server_info');
        });
    }
};
