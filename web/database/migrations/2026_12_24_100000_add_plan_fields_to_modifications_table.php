<?php

use App\Enums\ModStatus;
use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Schema;

return new class extends Migration
{
    /**
     * M5.3 "Pläne" (10 §5.9, m5.3-contract §1): a planned mod's target month, priority, private budget and the owner's order of the plans.
     * target_month, priority and plan_sort are set only while the mod is planned; the budget is the owner's alone (like cost_cents) and
     * stays after "Verbaut". Existing plans keep their relative order: plan_sort starts as their sort.
     */
    public function up(): void
    {
        Schema::table('modifications', function (Blueprint $table) {
            $table->date('target_month')->nullable()->after('installed_on');
            $table->string('priority', 10)->nullable()->after('target_month');
            $table->unsignedInteger('budget_cents')->nullable()->after('cost_cents');
            $table->unsignedInteger('plan_sort')->nullable()->after('sort');

            $table->index(['vehicle_id', 'status', 'plan_sort']);
            // M5.7's sweep for plans whose target month arrived.
            $table->index(['status', 'target_month']);
        });

        DB::table('modifications')->where('status', ModStatus::Planned->value)->update(['plan_sort' => DB::raw('sort')]);
    }

    public function down(): void
    {
        Schema::table('modifications', function (Blueprint $table) {
            $table->dropIndex(['vehicle_id', 'status', 'plan_sort']);
            $table->dropIndex(['status', 'target_month']);
            $table->dropColumn(['target_month', 'priority', 'budget_cents', 'plan_sort']);
        });
    }
};
