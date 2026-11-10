<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\Schema;

/**
 * M3.6 Team & roles, Audit & privacy, Settings, Memberships (m3.6 contract §1, 06_ADMIN_SPEC §2/§3). Additive only.
 *
 * - staff: the pending key of a TOTP rotation (SEC-P1-39: encrypted, bound to the session that started it, the old key works until the
 *   new one is confirmed with its own code), deactivated_at and anonymised_at (a deleted staff member stays as an anonymous row, because
 *   the audit log names them).
 * - staff_invitations: the 72-hour single-use invite links (only the SHA-256 of the token is stored).
 * - roles.description: custom roles of ADM-41.
 * - privacy_requests: GDPR requests of ADM-45/46 (due one month after receipt, extended once by two months with a reason).
 * - membership_plans / entitlements: the flagged scaffold of ADM-F1/F2 (premium.enabled), no payment data.
 */
return new class extends Migration
{
    public function up(): void
    {
        Schema::table('staff', function (Blueprint $table): void {
            $table->text('two_factor_pending_secret')->nullable()->after('two_factor_confirmed_at');
            $table->char('two_factor_pending_session', 64)->nullable()->after('two_factor_pending_secret');
            $table->timestamp('two_factor_pending_at')->nullable()->after('two_factor_pending_session');
            $table->timestamp('deactivated_at')->nullable()->after('status');
            $table->timestamp('anonymised_at')->nullable()->after('deactivated_at');
        });

        Schema::create('staff_invitations', function (Blueprint $table): void {
            $table->ulid('id')->primary();
            $table->foreignId('staff_id')->constrained('staff')->cascadeOnDelete();
            $table->foreignId('invited_by')->nullable()->constrained('staff')->nullOnDelete();
            $table->char('token_hash', 64)->unique();
            $table->timestamp('expires_at');
            $table->timestamp('used_at')->nullable();
            $table->timestamp('replaced_at')->nullable();
            $table->timestamps();

            $table->index(['staff_id', 'used_at']);
            $table->index('invited_by');
        });

        Schema::table(config('permission.table_names.roles', 'roles'), function (Blueprint $table): void {
            $table->string('description', 500)->nullable()->after('guard_name');
        });

        Schema::create('privacy_requests', function (Blueprint $table): void {
            $table->ulid('id')->primary();
            $table->string('type', 20);
            $table->string('status', 20)->default('open');
            $table->string('source', 20)->default('email');
            // The member the request concerns, when known; external requesters only have name and address.
            $table->foreignUlid('user_id')->nullable()->constrained()->nullOnDelete();
            $table->string('requester_name', 160)->nullable();
            $table->string('requester_email', 191)->nullable();
            $table->string('locale', 5)->default('de');
            $table->text('details')->nullable();
            $table->timestamp('received_at');
            $table->timestamp('due_at');
            $table->timestamp('extended_at')->nullable();
            $table->string('extension_reason', 1000)->nullable();
            $table->foreignId('assigned_to')->nullable()->constrained('staff')->nullOnDelete();
            $table->foreignId('created_by')->nullable()->constrained('staff')->nullOnDelete();
            $table->foreignId('completed_by')->nullable()->constrained('staff')->nullOnDelete();
            $table->timestamp('completed_at')->nullable();
            $table->text('evidence_note')->nullable();
            $table->string('evidence_path')->nullable();
            $table->string('evidence_name', 191)->nullable();
            $table->foreignUlid('data_export_id')->nullable()->constrained('data_exports')->nullOnDelete();
            $table->char('approval_request_id', 26)->nullable();
            $table->timestamp('last_reply_at')->nullable();
            $table->timestamps();

            $table->index(['status', 'due_at']);
            $table->index('type');
            $table->index('user_id');
            $table->index('assigned_to');
            $table->index('created_by');
            $table->index('completed_by');
            $table->index('data_export_id');
            $table->index('approval_request_id');
            $table->index('received_at');
        });

        Schema::create('membership_plans', function (Blueprint $table): void {
            $table->id();
            $table->string('key', 64)->unique();
            $table->json('name');
            $table->json('features');
            $table->boolean('active')->default(false)->index();
            $table->unsignedSmallInteger('sort')->default(0);
            $table->timestamps();
        });

        Schema::create('entitlements', function (Blueprint $table): void {
            $table->ulid('id')->primary();
            $table->foreignUlid('user_id')->constrained()->cascadeOnDelete();
            $table->foreignId('plan_id')->constrained('membership_plans')->restrictOnDelete();
            $table->foreignId('granted_by')->nullable()->constrained('staff')->nullOnDelete();
            $table->string('reason', 1000);
            $table->timestamp('starts_at');
            $table->timestamp('ends_at')->nullable();
            $table->timestamp('revoked_at')->nullable();
            $table->foreignId('revoked_by')->nullable()->constrained('staff')->nullOnDelete();
            $table->string('revoke_reason', 1000)->nullable();
            $table->timestamps();

            $table->index(['user_id', 'revoked_at']);
            $table->index('plan_id');
            $table->index('granted_by');
            $table->index('revoked_by');
            $table->index('ends_at');
        });
    }

    public function down(): void
    {
        Schema::dropIfExists('entitlements');
        Schema::dropIfExists('membership_plans');
        Schema::dropIfExists('privacy_requests');

        Schema::table(config('permission.table_names.roles', 'roles'), function (Blueprint $table): void {
            $table->dropColumn('description');
        });

        Schema::dropIfExists('staff_invitations');

        Schema::table('staff', function (Blueprint $table): void {
            $table->dropColumn(['two_factor_pending_secret', 'two_factor_pending_session', 'two_factor_pending_at', 'deactivated_at', 'anonymised_at']);
        });
    }
};
