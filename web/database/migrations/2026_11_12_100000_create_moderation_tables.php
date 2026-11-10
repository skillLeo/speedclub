<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\Schema;

/**
 * M2.6 safety (05_ARCHITECTURE §6 "Safety & support", m2.6-contract §1): DSA notices (reports), the cases that collect them (one open case
 * per target), the decisions with their statement of reasons (Art. 17 DSA) and the internal complaints (appeals, Art. 20 DSA).
 *
 * - `moderation_cases.open_target` holds "<type>:<id>" while a case is new or in review and null afterwards, so the unique index allows one
 *   open case per target and any number of closed ones (NULLs never collide on MySQL or MariaDB).
 * - `reports (case_id, reporter_id)` is unique: a member reports a target once per open case (409 already_reported). Web-form notices
 *   have no reporter and never collide.
 * - `reports.evidence` is encrypted (Laravel `encrypted:array`), so a text column: it may hold the reported message and its context
 *   (ADR-125 amendment, see the M2.6 handover).
 * - Kept with the case for 36 months (06_ADMIN_SPEC §4); the prune follows with the retention settings (ADM-47, Phase 3).
 */
return new class extends Migration
{
    public function up(): void
    {
        Schema::create('moderation_cases', function (Blueprint $table): void {
            $table->ulid('id')->primary();
            $table->string('target_type', 20);
            $table->string('target_id', 26)->charset('ascii')->collation('ascii_bin');
            $table->string('open_target', 60)->charset('ascii')->collation('ascii_bin')->nullable()->unique();
            // The member the case is about (owner of the content, or the reported member); null once the account is gone.
            $table->foreignUlid('subject_id')->nullable()->constrained('users')->nullOnDelete();
            $table->string('status', 16)->index();
            $table->unsignedSmallInteger('priority')->default(0);
            $table->unsignedInteger('report_count')->default(0);
            // Phase 3 [AI] triage, internal only ("KI-Vorschlag", a human decides).
            $table->decimal('ai_score', 5, 4)->nullable();
            $table->string('ai_summary', 500)->nullable();
            $table->foreignId('assigned_staff_id')->nullable()->constrained('staff')->nullOnDelete();
            $table->timestamp('decided_at')->nullable();
            $table->timestamps();

            $table->index(['target_type', 'target_id']);
            $table->index(['status', 'priority', 'created_at']);
            $table->index('subject_id');
            $table->index('assigned_staff_id');
        });

        Schema::create('reports', function (Blueprint $table): void {
            $table->ulid('id')->primary();
            $table->foreignUlid('reporter_id')->nullable()->constrained('users')->nullOnDelete();
            $table->foreignUlid('case_id')->constrained('moderation_cases')->cascadeOnDelete();
            $table->string('source', 16);
            $table->string('target_type', 20);
            $table->string('target_id', 26)->charset('ascii')->collation('ascii_bin');
            // What the target was called when it was reported ("@paul.roadster", "Mazda MX-5 (ND)"), language-free.
            $table->string('target_label', 200)->nullable();
            $table->string('reason', 20);
            $table->string('sub_reason', 20)->nullable();
            $table->text('details')->nullable();
            $table->string('contact_name', 100)->nullable();
            $table->string('contact_email', 254)->nullable();
            // The language of WEB-09 when it was sent, for the confirmation and the outcome mail.
            $table->string('contact_locale', 5)->nullable();
            $table->boolean('good_faith')->default(false);
            $table->longText('evidence')->nullable();
            $table->timestamp('created_at')->useCurrent();

            $table->unique(['case_id', 'reporter_id']);
            $table->index(['reporter_id', 'created_at']);
            $table->index(['target_type', 'target_id']);
        });

        Schema::create('decisions', function (Blueprint $table): void {
            $table->ulid('id')->primary();
            $table->foreignUlid('case_id')->unique()->constrained('moderation_cases')->cascadeOnDelete();
            $table->foreignUlid('subject_id')->nullable()->constrained('users')->nullOnDelete();
            $table->string('action', 20);
            $table->json('restriction')->nullable();
            $table->json('statement_of_reasons');
            $table->foreignId('decided_by')->nullable()->constrained('staff')->nullOnDelete();
            $table->timestamp('decided_at');
            $table->timestamp('notified_at')->nullable();
            // When the statement-of-reasons mail left (SendDecisionMail, queued with retries); null until then or when it failed.
            $table->timestamp('mailed_at')->nullable();
            $table->timestamps();

            $table->index(['subject_id', 'decided_at']);
            $table->index('decided_by');
            $table->index('action');
        });

        Schema::create('appeals', function (Blueprint $table): void {
            $table->ulid('id')->primary();
            $table->foreignUlid('decision_id')->constrained()->cascadeOnDelete();
            $table->foreignUlid('appellant_id')->nullable()->constrained('users')->nullOnDelete();
            $table->string('role', 16);
            $table->text('text');
            $table->string('status', 16)->index();
            $table->foreignId('decided_by')->nullable()->constrained('staff')->nullOnDelete();
            $table->timestamp('decided_at')->nullable();
            $table->timestamps();

            $table->unique(['decision_id', 'appellant_id']);
            $table->index('appellant_id');
            $table->index('decided_by');
        });
    }

    public function down(): void
    {
        Schema::dropIfExists('appeals');
        Schema::dropIfExists('decisions');
        Schema::dropIfExists('reports');
        Schema::dropIfExists('moderation_cases');
    }
};
