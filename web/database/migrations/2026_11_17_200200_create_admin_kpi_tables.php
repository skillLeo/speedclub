<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\Schema;

/**
 * Admin dashboard data (ADR-216, 06_ADMIN_SPEC §3 Overview), counts only.
 *
 * activity_days / activity_months: how many members were active on a German day or in a German month, counted when a member's
 * last_seen_at moves into a new one (App\Services\Admin\Kpi\ActivityTracker). No per-member history. activity_days.weekly is the
 * rolling seven-day count written once a day (speedclub:kpi-snapshot), so the WAU tile has a series.
 *
 * users.signup_ref: where sign-up began (SignupRef), for "QR-Scans → Registrierungen". Indexes for what the dashboard counts.
 */
return new class extends Migration
{
    public function up(): void
    {
        Schema::create('activity_days', function (Blueprint $table) {
            $table->date('day')->primary();
            $table->unsignedInteger('members')->default(0);
            $table->unsignedInteger('weekly')->nullable();
        });

        Schema::create('activity_months', function (Blueprint $table) {
            $table->date('month')->primary(); // the first day of the German month
            $table->unsignedInteger('members')->default(0);
        });

        Schema::table('users', function (Blueprint $table) {
            $table->string('signup_ref', 20)->nullable()->after('marketing_consent_at');
            $table->index('created_at');
            $table->index(['signup_ref', 'created_at']);
        });

        Schema::table('messages', function (Blueprint $table) {
            $table->index('created_at');
        });

        Schema::table('vehicles', function (Blueprint $table) {
            $table->index(['status', 'make_id']);
        });
    }

    public function down(): void
    {
        Schema::table('vehicles', function (Blueprint $table) {
            $table->dropIndex(['status', 'make_id']);
        });

        Schema::table('messages', function (Blueprint $table) {
            $table->dropIndex(['created_at']);
        });

        Schema::table('users', function (Blueprint $table) {
            $table->dropIndex(['signup_ref', 'created_at']);
            $table->dropIndex(['created_at']);
            $table->dropColumn('signup_ref');
        });

        Schema::dropIfExists('activity_months');
        Schema::dropIfExists('activity_days');
    }
};
