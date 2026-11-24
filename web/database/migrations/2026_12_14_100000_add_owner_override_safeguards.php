<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\Schema;

return new class extends Migration
{
    /**
     * M5.1 fix round (SEC-P5-01, SF-5, SEC-P5-07, ADR-507):
     * - approval_requests.eligible_at_request: the ids of the staff who could approve an Owner-Override action when it was asked
     *   (OwnerOverride::ACTIONS only, null elsewhere and for rows from before). The override needs this list empty AND nobody eligible now.
     * - approver_changes: every staff action that took approval rights from someone who held `approvals.decide` (atoms removed from a role
     *   they hold, a role taken away, deactivation, a 2FA reset). The override waits speedclub.approvals.override_cooldown_hours after the
     *   latest one, so emptying the approver list and overriding at once is not possible.
     * - staff_alerts: security mails to staff (Owner-Override, the governance switch, a draft taken over) sent through the queue with
     *   retries; one row per recipient and occasion (dedupe_key), so a retried job never mails twice and a lost mail stays visible.
     */
    public function up(): void
    {
        Schema::table('approval_requests', function (Blueprint $table): void {
            $table->json('eligible_at_request')->nullable()->after('requested_by');
        });

        Schema::create('approver_changes', function (Blueprint $table): void {
            $table->id();
            $table->foreignId('staff_id')->constrained('staff')->cascadeOnDelete();
            $table->string('cause', 32);
            $table->foreignId('changed_by')->nullable()->constrained('staff')->nullOnDelete();
            $table->timestamp('created_at')->useCurrent();
            $table->index('created_at');
        });

        Schema::create('staff_alerts', function (Blueprint $table): void {
            $table->ulid('id')->primary();
            $table->string('kind', 40);
            $table->string('dedupe_key', 191)->unique();
            $table->foreignId('staff_id')->constrained('staff')->cascadeOnDelete();
            $table->json('payload');
            $table->unsignedSmallInteger('attempts')->default(0);
            $table->timestamp('sent_at')->nullable();
            $table->timestamp('failed_at')->nullable();
            $table->timestamps();
            $table->index(['kind', 'created_at']);
        });
    }

    public function down(): void
    {
        Schema::dropIfExists('staff_alerts');
        Schema::dropIfExists('approver_changes');

        Schema::table('approval_requests', function (Blueprint $table): void {
            $table->dropColumn('eligible_at_request');
        });
    }
};
