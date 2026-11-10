<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\Schema;

/**
 * M3.7 [AI] features (m3.7 contract §1, 02_PRODUCT_SPEC §6, ADR-030). Additive only.
 *
 * - ai_calls: one row per provider call (feature, provider, model, latency, tokens, outcome, who asked). Never a prompt, an output or
 *   any content: the ids of the member or staff member are the only personal data. Pruned after 90 days (ai:prune).
 * - ai_translations: the 30-day cache of ai.translate per source, target language and the hash of the source text (encrypted).
 * - users.ai_suggestions: the member's opt-in (SET privacy, default off).
 * - media.ai_score / ai_summary / ai_scored_at: the moderation triage of a new photo (risk 0–1 = risk_score / 100, a German reason
 *   of at most 140 characters), as moderation_cases already has ai_score / ai_summary (05 §6).
 * - moderation_cases.ai_scored_at and ai_detected: when the triage last scored the case, and whether the case's detection came from
 *   the triage (a staff case opened on a photo the triage had flagged), for automated_detection in the statement of reasons (DSA
 *   Art. 17(3)(c)).
 */
return new class extends Migration
{
    public function up(): void
    {
        Schema::create('ai_calls', function (Blueprint $table): void {
            $table->ulid('id')->primary();
            $table->string('feature', 40);
            $table->string('provider', 40);
            $table->string('model', 80);
            $table->unsignedInteger('latency_ms')->default(0);
            $table->unsignedInteger('input_tokens')->default(0);
            $table->unsignedInteger('output_tokens')->default(0);
            $table->string('outcome', 16);
            $table->foreignUlid('member_id')->nullable()->constrained('users')->nullOnDelete();
            $table->foreignId('staff_id')->nullable()->constrained('staff')->nullOnDelete();
            $table->timestamp('created_at')->useCurrent();

            $table->index(['feature', 'created_at']);
            $table->index('created_at');
            $table->index('member_id');
            $table->index('staff_id');
            $table->index('outcome');
        });

        Schema::create('ai_translations', function (Blueprint $table): void {
            $table->ulid('id')->primary();
            $table->string('source_type', 24);
            $table->string('source_id', 26);
            $table->char('to', 2);
            $table->char('source_hash', 64);
            $table->text('text');
            $table->timestamp('expires_at');
            $table->timestamp('created_at')->useCurrent();

            $table->unique(['source_type', 'source_id', 'to', 'source_hash']);
            $table->index('expires_at');
        });

        Schema::table('users', function (Blueprint $table): void {
            $table->boolean('ai_suggestions')->default(false)->after('read_receipts');
        });

        Schema::table('media', function (Blueprint $table): void {
            $table->decimal('ai_score', 5, 4)->nullable()->after('ai_tags');
            $table->string('ai_summary', 140)->nullable()->after('ai_score');
            $table->timestamp('ai_scored_at')->nullable()->after('ai_summary');

            $table->index('ai_score');
        });

        Schema::table('moderation_cases', function (Blueprint $table): void {
            $table->timestamp('ai_scored_at')->nullable()->after('ai_summary');
            $table->boolean('ai_detected')->default(false)->after('ai_scored_at');

            $table->index('ai_score');
        });
    }

    public function down(): void
    {
        Schema::table('moderation_cases', function (Blueprint $table): void {
            $table->dropIndex(['ai_score']);
            $table->dropColumn(['ai_scored_at', 'ai_detected']);
        });

        Schema::table('media', function (Blueprint $table): void {
            $table->dropIndex(['ai_score']);
            $table->dropColumn(['ai_score', 'ai_summary', 'ai_scored_at']);
        });

        Schema::table('users', function (Blueprint $table): void {
            $table->dropColumn('ai_suggestions');
        });

        Schema::dropIfExists('ai_translations');
        Schema::dropIfExists('ai_calls');
    }
};
