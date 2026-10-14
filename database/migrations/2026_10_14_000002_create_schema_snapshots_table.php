<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\Schema;

return new class extends Migration
{
    public function up(): void
    {
        Schema::create('schema_snapshots', function (Blueprint $table) {
            $table->id();
            $table->foreignId('connection_id')->constrained('connections')->cascadeOnDelete();
            $table->char('hash', 40);
            $table->json('payload');
            $table->timestamp('created_at')->useCurrent();
            $table->index(['connection_id', 'id']);
        });
    }

    public function down(): void
    {
        Schema::dropIfExists('schema_snapshots');
    }
};
