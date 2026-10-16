<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\Schema;

return new class extends Migration
{
    public function up(): void
    {
        Schema::create('pinned_tables', function (Blueprint $table) {
            $table->id();
            $table->foreignId('user_id')->constrained()->cascadeOnDelete();
            $table->foreignId('connection_id')->constrained('connections')->cascadeOnDelete();
            $table->string('table_name', 255);
            $table->unsignedInteger('position');
            $table->timestamps();
            $table->unique(['user_id', 'connection_id', 'table_name']);
        });
    }

    public function down(): void
    {
        Schema::dropIfExists('pinned_tables');
    }
};
