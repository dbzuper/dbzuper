<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\Schema;

return new class extends Migration
{
    public function up(): void
    {
        Schema::create('transfers', function (Blueprint $table) {
            $table->uuid('id')->primary();
            $table->foreignId('user_id')->constrained()->cascadeOnDelete();
            $table->foreignId('saved_connection_id')->constrained('connections')->cascadeOnDelete();
            $table->string('database', 255)->default('');
            $table->string('direction', 16);
            $table->string('method', 16);
            $table->json('options');
            $table->string('status', 16);
            $table->unsignedBigInteger('bytes_done')->default(0);
            $table->unsignedBigInteger('bytes_total')->nullable();
            $table->unsignedBigInteger('rows_done')->default(0);
            $table->unsignedBigInteger('rows_total')->nullable();
            $table->unsignedBigInteger('statements_done')->default(0);
            $table->string('current_table', 255)->nullable();
            $table->string('file_name', 255);
            $table->string('file_path', 1024)->nullable();
            $table->unsignedBigInteger('file_size')->nullable();
            $table->json('warnings')->nullable();
            $table->text('error')->nullable();
            $table->timestamp('cancel_requested_at')->nullable();
            $table->timestamp('started_at')->nullable();
            $table->timestamp('finished_at')->nullable();
            $table->timestamp('expires_at')->nullable();
            $table->timestamps();
            $table->index(['saved_connection_id', 'database', 'status']);
        });
    }

    public function down(): void
    {
        Schema::dropIfExists('transfers');
    }
};
