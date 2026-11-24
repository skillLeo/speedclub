<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\Schema;

return new class extends Migration
{
    /**
     * M5.9c Build Journey + Build Score (10 §16.3, docs/reports/phase-5/m5.9c-contract.md §2–§3, ADR-508).
     *
     * - build_scores: one row per vehicle, written by App\Services\BuildScore\BuildScores (the debounced RecomputeBuildScore job and the
     *   nightly backstop). total 0–1000 and its four parts, the stage 1–5, the item breakdown, the total before the last change
     *   (previous_total, for the app's "+25") and the formula version it was computed with. M5.9b's RarityRules reads `total`.
     * - build_score_ranks: the nightly ranks by generation and by the owner's Bundesland, only for groups of at least
     *   build_score.ranks.min_group public cars (never samples, ghost or private cars).
     * - build_score_history: one row per vehicle and Berlin day on which the total changed (Wrapped, INS-01 progress).
     * - build_updates.kind: `post` (default) or `before_after`; the pair itself stays in the existing photo_pairs column (M4.11).
     */
    public function up(): void
    {
        Schema::create('build_scores', function (Blueprint $table): void {
            $table->foreignUlid('vehicle_id')->primary()->constrained('vehicles')->cascadeOnDelete();
            $table->unsignedSmallInteger('total')->default(0);
            $table->unsignedSmallInteger('completeness')->default(0);
            $table->unsignedSmallInteger('documentation')->default(0);
            $table->unsignedSmallInteger('community')->default(0);
            $table->unsignedSmallInteger('journey')->default(0);
            $table->unsignedTinyInteger('stage')->default(1);
            $table->json('breakdown')->nullable();
            $table->unsignedSmallInteger('previous_total')->nullable();
            $table->string('formula_version', 16);
            $table->timestamp('changed_at')->nullable();
            $table->timestamp('computed_at')->nullable();
            $table->index('total', 'build_scores_total_index');
        });

        Schema::create('build_score_ranks', function (Blueprint $table): void {
            $table->id();
            $table->foreignUlid('vehicle_id')->constrained('vehicles')->cascadeOnDelete();
            $table->string('scope', 16);
            $table->string('scope_key', 32);
            $table->unsignedInteger('rank');
            $table->unsignedInteger('group_size');
            $table->timestamp('computed_at')->nullable();
            $table->unique(['vehicle_id', 'scope'], 'build_score_ranks_vehicle_scope_unique');
            $table->index(['scope', 'scope_key'], 'build_score_ranks_scope_key_index');
            $table->index('computed_at', 'build_score_ranks_computed_at_index');
        });

        Schema::create('build_score_history', function (Blueprint $table): void {
            $table->id();
            $table->foreignUlid('vehicle_id')->constrained('vehicles')->cascadeOnDelete();
            $table->date('day');
            $table->unsignedSmallInteger('total');
            $table->unique(['vehicle_id', 'day'], 'build_score_history_vehicle_day_unique');
        });

        Schema::table('build_updates', function (Blueprint $table): void {
            $table->string('kind', 20)->default('post')->after('type');
            $table->index(['vehicle_id', 'kind'], 'build_updates_vehicle_kind_index');
        });
    }

    public function down(): void
    {
        Schema::table('build_updates', function (Blueprint $table): void {
            $table->dropIndex('build_updates_vehicle_kind_index');
            $table->dropColumn('kind');
        });

        Schema::dropIfExists('build_score_history');
        Schema::dropIfExists('build_score_ranks');
        Schema::dropIfExists('build_scores');
    }
};
