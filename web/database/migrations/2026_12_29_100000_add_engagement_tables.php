<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\Schema;

return new class extends Migration
{
    /**
     * M5.7 Engagement (10 §6, m5.7-contract §1):
     * - view_salts: the key of the viewer hash, one per Europe/Berlin day, deleted when the day is over (then no stored hash can be tied
     *   to anybody any more);
     * - view_events: one row per viewer, subject and day (the dedupe), source of the first view; no IP, user agent, user or device column;
     *   kept 90 days (views:prune);
     * - view_days: unique viewers per subject, day and source, written with the event, what INS-01 and the badge metric read;
     * - weekly_recaps: one row per member and ISO week (the Sunday recap's idempotency and its skip record), kept 12 weeks;
     * - engagement_push_claims: the three engagement pushes a member may get per ISO week (unique slot), kept 14 days;
     * - vehicles.build_goal_season ("Ziel: Saison 2027"), modifications.plan_prompted_for (the target month already asked about).
     */
    public function up(): void
    {
        Schema::create('view_salts', function (Blueprint $table) {
            $table->date('day')->primary();
            $table->char('salt', 64);
            $table->timestamp('created_at')->nullable();
        });

        Schema::create('view_events', function (Blueprint $table) {
            $table->id();
            $table->string('subject_type', 10);
            $table->char('subject_id', 26);
            $table->foreignUlid('owner_id')->constrained('users')->cascadeOnDelete();
            $table->foreignUlid('vehicle_id')->nullable()->constrained('vehicles')->cascadeOnDelete();
            $table->date('day');
            $table->string('source', 16);
            $table->char('viewer_hash', 32);
            $table->timestamp('created_at')->nullable();

            $table->unique(['subject_type', 'subject_id', 'day', 'viewer_hash'], 'view_events_dedupe_unique');
            $table->index('created_at');
        });

        Schema::create('view_days', function (Blueprint $table) {
            $table->id();
            $table->string('subject_type', 10);
            $table->char('subject_id', 26);
            $table->foreignUlid('owner_id')->constrained('users')->cascadeOnDelete();
            $table->foreignUlid('vehicle_id')->nullable()->constrained('vehicles')->cascadeOnDelete();
            $table->date('day');
            $table->string('source', 16);
            $table->unsignedInteger('views')->default(0);

            $table->unique(['subject_type', 'subject_id', 'day', 'source'], 'view_days_subject_day_source_unique');
            $table->index(['owner_id', 'day']);
            $table->index(['vehicle_id', 'day']);
            $table->index('day');
        });

        Schema::create('weekly_recaps', function (Blueprint $table) {
            $table->id();
            $table->foreignUlid('user_id')->constrained('users')->cascadeOnDelete();
            $table->date('week');
            $table->string('status', 12);
            $table->json('channels')->nullable();
            $table->json('payload')->nullable();
            $table->timestamp('created_at')->nullable();

            $table->unique(['user_id', 'week']);
            $table->index(['week', 'status']);
        });

        Schema::create('engagement_push_claims', function (Blueprint $table) {
            $table->id();
            $table->foreignUlid('user_id')->constrained('users')->cascadeOnDelete();
            $table->date('week');
            $table->unsignedTinyInteger('slot');
            $table->string('type', 40);
            $table->ulid('notification_id')->nullable();
            $table->timestamp('created_at')->nullable();

            $table->unique(['user_id', 'week', 'slot']);
            $table->index('week');
        });

        Schema::table('vehicles', function (Blueprint $table) {
            $table->unsignedSmallInteger('build_goal_season')->nullable();
        });

        Schema::table('modifications', function (Blueprint $table) {
            $table->date('plan_prompted_for')->nullable()->after('target_month');
        });
    }

    public function down(): void
    {
        Schema::table('modifications', function (Blueprint $table) {
            $table->dropColumn('plan_prompted_for');
        });

        Schema::table('vehicles', function (Blueprint $table) {
            $table->dropColumn('build_goal_season');
        });

        Schema::dropIfExists('engagement_push_claims');
        Schema::dropIfExists('weekly_recaps');
        Schema::dropIfExists('view_days');
        Schema::dropIfExists('view_events');
        Schema::dropIfExists('view_salts');
    }
};
