<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\Schema;

return new class extends Migration
{
    /**
     * M5.9 AI helpers (10 §8, m5.9-contract §2, §5):
     * - ai_spec_suggestions: typical factory specs per catalogue generation (or model + year), shared by every member, no member data;
     * - ai_text_normalisations: the AI's catalogue terms for a typed part ("kw v3" → brand + product words), no member data;
     * - forum_thread_summaries: the 3-line "KI-Zusammenfassung" of a long thread, with the posts and authors it was built from;
     * - vehicle_specs.ai_fields: the spec values a member took over from a suggestion and has not changed since ({field: value});
     * - moderation_cases.ai_template_key: the triage's suggested statement-of-reasons template (a human decides).
     */
    public function up(): void
    {
        Schema::create('ai_spec_suggestions', function (Blueprint $table) {
            $table->ulid('id')->primary();
            $table->foreignId('generation_id')->nullable()->constrained('generations')->cascadeOnDelete();
            $table->foreignId('model_id')->nullable()->constrained('vehicle_models')->cascadeOnDelete();
            $table->unsignedSmallInteger('model_year')->nullable();
            $table->char('cache_key', 64)->unique();
            $table->json('payload');
            $table->ulid('ai_call_id')->nullable();
            $table->timestamp('created_at')->nullable();
            $table->timestamp('expires_at')->index();
        });

        Schema::create('ai_text_normalisations', function (Blueprint $table) {
            $table->id();
            $table->string('feature', 40);
            $table->char('cache_key', 64)->unique();
            $table->json('payload');
            $table->timestamp('created_at')->nullable();
            $table->timestamp('expires_at')->index();
        });

        Schema::create('forum_thread_summaries', function (Blueprint $table) {
            $table->foreignUlid('thread_id')->primary()->constrained('forum_threads')->cascadeOnDelete();
            $table->json('lines');
            $table->unsignedInteger('based_on_replies');
            $table->json('post_ids');
            $table->json('author_ids');
            $table->ulid('ai_call_id')->nullable();
            $table->timestamp('generated_at')->index();
        });

        Schema::table('vehicle_specs', function (Blueprint $table) {
            $table->json('ai_fields')->nullable();
        });

        Schema::table('moderation_cases', function (Blueprint $table) {
            $table->string('ai_template_key', 60)->nullable()->after('ai_summary');
        });
    }

    public function down(): void
    {
        Schema::table('moderation_cases', function (Blueprint $table) {
            $table->dropColumn('ai_template_key');
        });

        Schema::table('vehicle_specs', function (Blueprint $table) {
            $table->dropColumn('ai_fields');
        });

        Schema::dropIfExists('forum_thread_summaries');
        Schema::dropIfExists('ai_text_normalisations');
        Schema::dropIfExists('ai_spec_suggestions');
    }
};
