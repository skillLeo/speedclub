<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\Schema;

return new class extends Migration
{
    public function up(): void
    {
        Schema::create('follows', function (Blueprint $table) {
            $table->id();
            $table->foreignUlid('follower_id')->constrained('users')->cascadeOnDelete();
            $table->foreignUlid('followee_id')->constrained('users')->cascadeOnDelete();
            $table->timestamp('created_at')->nullable();

            $table->unique(['follower_id', 'followee_id']);
            $table->index(['followee_id', 'created_at']);
        });

        Schema::create('blocks', function (Blueprint $table) {
            $table->id();
            $table->foreignUlid('blocker_id')->constrained('users')->cascadeOnDelete();
            $table->foreignUlid('blocked_id')->constrained('users')->cascadeOnDelete();
            $table->timestamp('created_at')->nullable();

            $table->unique(['blocker_id', 'blocked_id']);
            $table->index('blocked_id');
        });

        Schema::create('saves', function (Blueprint $table) {
            $table->id();
            $table->foreignUlid('user_id')->constrained()->cascadeOnDelete();
            $table->foreignUlid('vehicle_id')->constrained()->cascadeOnDelete();
            $table->timestamp('created_at')->nullable();

            $table->unique(['user_id', 'vehicle_id']);
            $table->index(['vehicle_id', 'created_at']);
        });
    }

    public function down(): void
    {
        Schema::dropIfExists('saves');
        Schema::dropIfExists('blocks');
        Schema::dropIfExists('follows');
    }
};
