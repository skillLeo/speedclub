<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Schema;

return new class extends Migration
{
    /**
     * M5.9d supporting system (10 §16.4, docs/reports/phase-5/m5.9d-contract.md §1–§5, ADR-508).
     *
     * - users: xp (the sum of the member's xp_events, kept in the award transaction), founding_number (#0001–#1000, production only,
     *   never re-used: taken from sequence_counters.founding_number), activated_at (the moment the account first had a verified address and
     *   accepted terms: founding number and invite redemption happen exactly once, there), pending_invite_code (the code a sign-up carried,
     *   redeemed at activation, then cleared). Existing activated members get activated_at = their verification time, so a later sign-in
     *   with a code never counts as a new activation.
     * - xp_events: one row per (member, type, source); a capped event keeps its row with points 0 (or the rest of the day) and capped,
     *   so the daily cap is auditable and re-runs stay idempotent. day = the Europe/Berlin day the cap counts in.
     * - badges (seeded by BadgeSeeder, edited in the admin badge manager) and user_badges (seen_at: the unlock toast showed).
     * - car_of_the_day: one row per Europe/Berlin day (a skipped day too), published at 18:00.
     * - invite_codes: 8 characters Crockford, five per member, created on the first read.
     */
    public function up(): void
    {
        Schema::table('users', function (Blueprint $table): void {
            $table->unsignedInteger('xp')->default(0);
            $table->unsignedSmallInteger('founding_number')->nullable()->unique();
            $table->timestamp('activated_at')->nullable();
            $table->char('pending_invite_code', 8)->nullable();
        });

        DB::table('users')
            ->whereNotNull('email_verified_at')
            ->where(fn ($query) => $query->whereNull('onboarding_state')->orWhere('onboarding_state', '!=', 'pending_terms'))
            ->update(['activated_at' => DB::raw('email_verified_at')]);

        Schema::create('xp_events', function (Blueprint $table): void {
            $table->id();
            $table->foreignUlid('user_id')->constrained()->cascadeOnDelete();
            $table->string('type', 32);
            $table->unsignedSmallInteger('points');
            $table->boolean('capped')->default(false);
            $table->string('ref_type', 32);
            $table->string('ref_id', 100);
            $table->date('day');
            $table->timestamp('created_at')->nullable();
            $table->unique(['user_id', 'type', 'ref_type', 'ref_id'], 'xp_events_source_unique');
            $table->index(['user_id', 'day'], 'xp_events_user_day_index');
            $table->index(['ref_type', 'ref_id'], 'xp_events_ref_index');
        });

        Schema::create('badges', function (Blueprint $table): void {
            $table->string('key', 64)->primary();
            $table->string('name_de', 80);
            $table->string('name_en', 80);
            $table->string('description_de', 255);
            $table->string('description_en', 255);
            $table->string('hint_de', 160)->nullable();
            $table->string('hint_en', 160)->nullable();
            $table->json('rule_json');
            $table->boolean('hidden')->default(false);
            $table->string('tier', 8);
            $table->string('category', 16);
            $table->unsignedSmallInteger('sort')->default(0);
            $table->boolean('active')->default(true);
            $table->timestamps();
            $table->index(['active', 'sort'], 'badges_active_sort_index');
            $table->index('category', 'badges_category_index');
        });

        Schema::create('user_badges', function (Blueprint $table): void {
            $table->id();
            $table->foreignUlid('user_id')->constrained()->cascadeOnDelete();
            $table->string('badge_key', 64);
            $table->foreign('badge_key')->references('key')->on('badges')->cascadeOnUpdate()->cascadeOnDelete();
            $table->timestamp('awarded_at');
            $table->string('source_ref', 100)->nullable();
            $table->timestamp('seen_at')->nullable();
            $table->unique(['user_id', 'badge_key'], 'user_badges_user_badge_unique');
            $table->index(['user_id', 'seen_at'], 'user_badges_user_seen_index');
            $table->index('badge_key', 'user_badges_badge_key_index');
        });

        Schema::create('car_of_the_day', function (Blueprint $table): void {
            $table->id();
            $table->date('day')->unique();
            $table->foreignUlid('vehicle_id')->nullable()->constrained()->cascadeOnDelete();
            $table->string('story_line', 140)->nullable();
            $table->char('bundesland', 2)->nullable();
            $table->string('source', 8);
            $table->boolean('is_sample')->default(false);
            $table->boolean('skipped')->default(false);
            $table->string('skipped_reason', 500)->nullable();
            $table->foreignId('decided_by')->nullable()->constrained('staff')->nullOnDelete();
            $table->timestamp('picked_at');
            $table->timestamp('published_at')->nullable();
            $table->timestamp('notified_at')->nullable();
            $table->timestamps();
            $table->index('bundesland', 'car_of_the_day_bundesland_index');
            $table->index('published_at', 'car_of_the_day_published_at_index');
        });

        Schema::create('invite_codes', function (Blueprint $table): void {
            $table->char('code', 8)->primary();
            $table->foreignUlid('inviter_id')->constrained('users')->cascadeOnDelete();
            $table->foreignUlid('accepted_by')->nullable()->unique()->constrained('users')->nullOnDelete();
            $table->timestamp('accepted_at')->nullable();
            $table->timestamp('created_at')->nullable();
            $table->index('inviter_id', 'invite_codes_inviter_index');
        });
    }

    public function down(): void
    {
        Schema::dropIfExists('invite_codes');
        Schema::dropIfExists('car_of_the_day');
        Schema::dropIfExists('user_badges');
        Schema::dropIfExists('badges');
        Schema::dropIfExists('xp_events');

        Schema::table('users', function (Blueprint $table): void {
            $table->dropUnique(['founding_number']);
            $table->dropColumn(['xp', 'founding_number', 'activated_at', 'pending_invite_code']);
        });
    }
};
