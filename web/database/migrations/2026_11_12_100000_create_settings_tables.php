<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\Schema;

/**
 * M2.5 settings: data exports (SET-12), help articles (SET-14), support tickets (SET-15, WEB-10) and the TOTP replay guard (SET-05).
 */
return new class extends Migration
{
    public function up(): void
    {
        // The last TOTP time step a code was accepted for: the same code (or an older one) never counts twice (RFC 6238 §5.2).
        Schema::table('users', function (Blueprint $table): void {
            $table->unsignedBigInteger('two_factor_last_step')->nullable()->after('two_factor_confirmed_at');
        });

        Schema::create('data_exports', function (Blueprint $table): void {
            $table->ulid('id')->primary();
            $table->foreignUlid('user_id')->constrained()->cascadeOnDelete();
            $table->string('status', 16)->index();
            $table->timestamp('requested_at')->useCurrent();
            $table->timestamp('started_at')->nullable();
            $table->timestamp('ready_at')->nullable();
            $table->timestamp('expires_at')->nullable()->index();
            $table->timestamp('failed_at')->nullable();
            // Private disk, relative path of the ZIP while it is written and once it is ready.
            $table->string('path')->nullable();
            $table->unsignedBigInteger('bytes')->default(0);
            // Where the next job continues: stage, the ZIP offset of the last complete entry, the last photo copied.
            $table->json('progress')->nullable();
            $table->timestamps();

            $table->index(['user_id', 'requested_at']);
        });

        Schema::create('help_articles', function (Blueprint $table): void {
            $table->id();
            $table->string('key', 64);
            $table->string('locale', 5);
            $table->string('title', 160);
            $table->text('body_md');
            $table->unsignedSmallInteger('sort')->default(0);
            $table->boolean('published')->default(true);
            $table->timestamps();

            $table->unique(['key', 'locale']);
            $table->index(['locale', 'published', 'sort']);
        });

        Schema::create('support_tickets', function (Blueprint $table): void {
            $table->ulid('id')->primary();
            // Null for a guest from WEB-10, and after the member's account was hard-deleted.
            $table->foreignUlid('user_id')->nullable()->constrained()->nullOnDelete();
            $table->string('source', 8);
            $table->string('category', 16)->index();
            $table->string('subject', 120);
            $table->string('status', 16)->default('open');
            // Guests only: a member's address is read from the account.
            $table->string('name', 80)->nullable();
            $table->string('email')->nullable();
            $table->string('locale', 5)->default('de');
            $table->timestamp('closed_at')->nullable();
            $table->timestamps();

            $table->index(['status', 'created_at']);
            $table->index('created_at');
        });

        Schema::create('ticket_messages', function (Blueprint $table): void {
            $table->ulid('id')->primary();
            $table->foreignUlid('ticket_id')->constrained('support_tickets')->cascadeOnDelete();
            $table->string('author_type', 8);
            $table->foreignUlid('user_id')->nullable()->constrained()->nullOnDelete();
            $table->foreignId('staff_id')->nullable()->constrained('staff')->nullOnDelete();
            $table->text('body');
            $table->timestamp('created_at')->useCurrent();

            $table->index(['ticket_id', 'created_at']);
        });
    }

    public function down(): void
    {
        Schema::dropIfExists('ticket_messages');
        Schema::dropIfExists('support_tickets');
        Schema::dropIfExists('help_articles');
        Schema::dropIfExists('data_exports');

        Schema::table('users', function (Blueprint $table): void {
            $table->dropColumn('two_factor_last_step');
        });
    }
};
