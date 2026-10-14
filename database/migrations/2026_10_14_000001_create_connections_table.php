<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\Schema;

return new class extends Migration
{
    public function up(): void
    {
        Schema::create('connections', function (Blueprint $table) {
            $table->id();
            $table->foreignId('user_id')->constrained()->cascadeOnDelete();
            $table->string('name', 100);
            $table->string('driver', 16);
            $table->string('host')->nullable();
            $table->unsignedInteger('port')->nullable();
            $table->string('database', 1024);
            $table->string('username')->nullable();
            $table->text('password')->nullable();
            $table->text('options')->nullable();
            $table->boolean('read_only')->default(false);
            $table->string('color', 16)->nullable();
            $table->boolean('store_history')->default(true);
            $table->timestamps();
        });
    }

    public function down(): void
    {
        Schema::dropIfExists('connections');
    }
};
