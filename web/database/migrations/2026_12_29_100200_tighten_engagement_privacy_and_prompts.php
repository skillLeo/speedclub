<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\Schema;

return new class extends Migration
{
    /**
     * M5.7 review (docs/reports/phase-5/review-m5.6-m5.7.md):
     * - MF-1: users.plan_prompted_at, the owner's last build prompt. The 1-per-7-days limit of PlanDuePrompts reads it; the in-app row
     *   alone could not hold it, as installing or deleting the plan removes that row.
     * - SF-2: view_events keeps no time of day any more — only the Berlin day, which the dedupe needs anyway. A second-exact timestamp next
     *   to the access log of the host could tie a hash to a person after the day's salt is gone. Pruned by `day` (indexed).
     */
    public function up(): void
    {
        Schema::table('users', function (Blueprint $table) {
            $table->timestamp('plan_prompted_at')->nullable();
        });

        Schema::table('view_events', function (Blueprint $table) {
            $table->dropIndex(['created_at']);
            $table->dropColumn('created_at');
            $table->index('day');
        });
    }

    public function down(): void
    {
        Schema::table('view_events', function (Blueprint $table) {
            $table->dropIndex(['day']);
            $table->timestamp('created_at')->nullable();
            $table->index('created_at');
        });

        Schema::table('users', function (Blueprint $table) {
            $table->dropColumn('plan_prompted_at');
        });
    }
};
