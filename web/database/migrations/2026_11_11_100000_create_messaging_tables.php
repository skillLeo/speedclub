<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\Schema;

/**
 * M2.4 messaging (05_ARCHITECTURE §6, m2.4-contract §1). One conversation per pair of members (pair_key = the two user ids, smaller
 * first), one participant row per member with that member's folder, read mark, counters and organise state, and the messages. Message
 * ids are ULIDs handed out under the conversation's row lock, strictly increasing per conversation (App\Services\Messaging\MessageIds),
 * so `messages?after=` never misses a message that committed late.
 *
 * Bodies live in messages.body only: no other column, cache, log or idempotency row holds them (ADR-125).
 */
return new class extends Migration
{
    public function up(): void
    {
        Schema::create('conversations', function (Blueprint $table): void {
            $table->ulid('id')->primary();
            $table->string('pair_key', 53)->charset('ascii')->collation('ascii_bin')->unique();
            $table->foreignUlid('created_by')->nullable()->constrained('users')->nullOnDelete();
            // The context card: the vehicle of the latest start from a vehicle page.
            $table->foreignUlid('vehicle_id')->nullable()->constrained('vehicles')->nullOnDelete();
            $table->ulid('last_message_id')->nullable();
            $table->timestamp('last_message_at', 6)->nullable();
            $table->timestamps();
        });

        Schema::create('conversation_participants', function (Blueprint $table): void {
            $table->id();
            $table->foreignUlid('conversation_id')->constrained()->cascadeOnDelete();
            $table->foreignUlid('user_id')->constrained()->cascadeOnDelete();
            $table->string('folder', 16);
            $table->timestamp('accepted_at')->nullable();
            $table->ulid('last_read_message_id')->nullable();
            $table->timestamp('last_read_at')->nullable();
            $table->unsignedInteger('unread_count')->default(0);
            $table->timestamp('muted_until')->nullable();
            $table->timestamp('pinned_at')->nullable();
            $table->timestamp('archived_at')->nullable();
            // Delete for me (and a block): hidden until a later message from the other side; history before the point stays hidden.
            $table->timestamp('deleted_at')->nullable();
            $table->ulid('cleared_before_message_id')->nullable();
            // The recipient declined the request: hidden for them, and the sender's request stays pending (never told).
            $table->timestamp('declined_at')->nullable();
            // The daily e-mail digest has told about the conversation up to this message.
            $table->ulid('digested_message_id')->nullable();
            // Copied from the conversation, so the inbox reads one index.
            $table->timestamp('last_message_at', 6)->nullable();
            $table->timestamps();

            $table->unique(['conversation_id', 'user_id']);
            $table->index(['user_id', 'folder', 'last_message_at']);
            $table->index(['user_id', 'deleted_at', 'folder']);
        });

        Schema::create('messages', function (Blueprint $table): void {
            $table->ulid('id')->primary();
            $table->foreignUlid('conversation_id')->constrained()->cascadeOnDelete();
            // Null once the account is hard-deleted: the other side keeps the copy ("Gelöschtes Mitglied").
            $table->foreignUlid('sender_id')->nullable()->constrained('users')->nullOnDelete();
            $table->string('client_id', 64)->charset('ascii')->collation('ascii_bin');
            $table->string('idempotency_key', 128)->charset('ascii')->collation('ascii_bin')->nullable();
            $table->string('type', 16);
            $table->text('body')->nullable();
            $table->foreignUlid('media_id')->nullable()->constrained('media')->nullOnDelete();
            $table->foreignUlid('vehicle_id')->nullable()->constrained('vehicles')->nullOnDelete();
            $table->timestamp('created_at', 6)->useCurrent();
            $table->softDeletes();

            $table->unique(['sender_id', 'client_id']);
            $table->unique(['sender_id', 'idempotency_key']);
            $table->index(['conversation_id', 'id']);
        });

        Schema::create('message_hidden', function (Blueprint $table): void {
            $table->foreignUlid('message_id')->constrained()->cascadeOnDelete();
            $table->foreignUlid('user_id')->constrained()->cascadeOnDelete();
            $table->timestamp('created_at')->useCurrent();

            $table->primary(['message_id', 'user_id']);
            $table->index('user_id');
        });

        Schema::create('message_reactions', function (Blueprint $table): void {
            $table->foreignUlid('message_id')->constrained()->cascadeOnDelete();
            $table->foreignUlid('user_id')->constrained()->cascadeOnDelete();
            $table->string('reaction', 16);
            $table->timestamp('created_at')->useCurrent();

            $table->primary(['message_id', 'user_id']);
            $table->index('user_id');
        });
    }

    public function down(): void
    {
        Schema::dropIfExists('message_reactions');
        Schema::dropIfExists('message_hidden');
        Schema::dropIfExists('messages');
        Schema::dropIfExists('conversation_participants');
        Schema::dropIfExists('conversations');
    }
};
