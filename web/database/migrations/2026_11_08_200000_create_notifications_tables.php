<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\Schema;

/**
 * M2.2 notifications (05_ARCHITECTURE §6 "Laravel notifications table + group_key"). Rows are written by App\Services\Notifications\Notifier
 * only. The Laravel columns stay (id, type, notifiable_type/_id, data, read_at, timestamps); type holds the key of NotificationType, not a
 * class name. notifiable_id carries a foreign key to users as well, since every recipient is a member, so a hard-deleted account takes its
 * rows along.
 *
 * notification_actors: who a grouped row is about ("lukas.sc und 3 weitere"), so reads can leave out actors who are blocked or gone with
 * plain joins (no JSON functions, as everywhere else). push_tickets: Expo tickets waiting for their receipt (push:receipts).
 */
return new class extends Migration
{
    public function up(): void
    {
        Schema::create('notifications', function (Blueprint $table) {
            $table->ulid('id')->primary();
            $table->string('type', 40);
            $table->string('notifiable_type', 40)->default('user');
            $table->foreignUlid('notifiable_id')->constrained('users')->cascadeOnDelete();
            $table->string('group_key', 120)->nullable()->index();
            $table->foreignUlid('actor_id')->nullable()->constrained('users')->nullOnDelete();
            $table->unsignedInteger('actor_count')->default(0);
            $table->foreignUlid('vehicle_id')->nullable()->constrained()->cascadeOnDelete();
            $table->json('data')->nullable();
            $table->timestamp('read_at')->nullable();
            // The latest event of the row: a grouped row moves up when somebody joins it.
            $table->timestamp('created_at')->useCurrent();
            $table->timestamp('updated_at')->nullable();
            $table->timestamp('pushed_at')->nullable();

            // One row per group and recipient; rows without a group_key (NULL) never collide.
            $table->unique(['notifiable_id', 'group_key']);
            $table->index(['notifiable_id', 'created_at', 'id']);
            $table->index(['notifiable_id', 'read_at']);
            $table->index('created_at');
        });

        Schema::create('notification_actors', function (Blueprint $table) {
            $table->foreignUlid('notification_id')->constrained()->cascadeOnDelete();
            $table->foreignUlid('actor_id')->constrained('users')->cascadeOnDelete();
            $table->timestamp('created_at')->useCurrent();

            $table->primary(['notification_id', 'actor_id']);
            $table->index('actor_id');
        });

        Schema::create('push_tickets', function (Blueprint $table) {
            $table->id();
            $table->string('ticket_id', 64)->unique();
            $table->foreignUlid('push_token_id')->constrained()->cascadeOnDelete();
            $table->timestamp('created_at')->useCurrent()->index();
        });
    }

    public function down(): void
    {
        Schema::dropIfExists('push_tickets');
        Schema::dropIfExists('notification_actors');
        Schema::dropIfExists('notifications');
    }
};
