<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\Schema;

return new class extends Migration
{
    public function up(): void
    {
        Schema::create('query_history', function (Blueprint $table) {
            $table->id();
            $table->foreignId('connection_id')->constrained('connections')->cascadeOnDelete();
            $table->mediumText('sql');
            $table->string('kind', 16);
            $table->string('status', 8); // ok | error
            $table->unsignedInteger('duration_ms');
            $table->unsignedInteger('row_count')->nullable();
            $table->unsignedBigInteger('affected')->nullable();
            $table->text('error')->nullable();
            $table->timestamp('created_at')->useCurrent();
            $table->index(['connection_id', 'id']);
        });
    }

    public function down(): void
    {
        Schema::dropIfExists('query_history');
    }
};
