<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\Schema;

/**
 * M3.2 (members, vehicles, media, QR; m3.2-contract §1, §1a). Additive only.
 *
 * - `moderation_cases.origin`: `report` (opened by a report, M2.6) or `staff` (an own-initiative case: staff restricted, suspended or
 *   hid something without a report, or reversed an earlier decision). `target_label` names the target of an own-initiative case for
 *   the statement of reasons, where a reported case takes the label of its first report.
 * - `decisions.reverses_decision_id`: a `reverse` decision lifts the restriction or brings back the content of the decision it names;
 *   unique, so a decision is reversed at most once. `decisions.restore` is what a remove_content decision changed (a vehicle's
 *   visibility, a profile's name), so the reversal can put it back; internal, never in an API resource.
 * - `media.reviewed_at` / `reviewed_by`: ADM-13 "Freigeben"; the "Neu" tab lists photos nobody reviewed yet, newest first.
 * - `data_exports.requested_by_staff_id`: the SET-12 export built for staff (four-eyes `members.export`): not listed to the member,
 *   not mailed to them, downloadable by the requester for 24 hours.
 */
return new class extends Migration
{
    public function up(): void
    {
        Schema::table('moderation_cases', function (Blueprint $table): void {
            $table->string('origin', 16)->default('report')->after('target_id');
            $table->string('target_label', 200)->nullable()->after('origin');
            $table->index(['origin', 'status']);
        });

        Schema::table('decisions', function (Blueprint $table): void {
            $table->foreignUlid('reverses_decision_id')->nullable()->after('subject_id')->unique()->constrained('decisions')->nullOnDelete();
            $table->json('restore')->nullable()->after('statement_of_reasons');
            $table->index(['subject_id', 'action']);
        });

        Schema::table('media', function (Blueprint $table): void {
            $table->timestamp('reviewed_at')->nullable()->after('moderation_status');
            $table->foreignId('reviewed_by')->nullable()->after('reviewed_at')->constrained('staff')->nullOnDelete();
            $table->index(['reviewed_at', 'created_at']);
        });

        Schema::table('data_exports', function (Blueprint $table): void {
            $table->foreignId('requested_by_staff_id')->nullable()->after('user_id')->constrained('staff')->nullOnDelete();
        });
    }

    public function down(): void
    {
        Schema::table('data_exports', function (Blueprint $table): void {
            $table->dropConstrainedForeignId('requested_by_staff_id');
        });

        Schema::table('media', function (Blueprint $table): void {
            $table->dropIndex(['reviewed_at', 'created_at']);
            $table->dropConstrainedForeignId('reviewed_by');
            $table->dropColumn('reviewed_at');
        });

        Schema::table('decisions', function (Blueprint $table): void {
            $table->dropIndex(['subject_id', 'action']);
            $table->dropConstrainedForeignId('reverses_decision_id');
            $table->dropColumn('restore');
        });

        Schema::table('moderation_cases', function (Blueprint $table): void {
            $table->dropIndex(['origin', 'status']);
            $table->dropColumn(['origin', 'target_label']);
        });
    }
};
