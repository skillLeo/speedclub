<?php

use App\Enums\CrewEndReason;
use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Schema;

/**
 * R4DQ-55 (round-4 design re-review): a crew the system ended (the last member's account closed, C8; or CrewRepair, 2027_01_13_100000)
 * read "Vom Gründer gelöscht" in ADM-80. crews.ended_reason marks those ends; it is backfilled from the audit rows those ends wrote
 * (crew.deleted with reason `repair`, or with `account_closed` in its after data). Idempotent; down drops the column.
 */
return new class extends Migration
{
    public function up(): void
    {
        if (! Schema::hasTable('crews')) {
            return;
        }

        if (! Schema::hasColumn('crews', 'ended_reason')) {
            Schema::table('crews', function (Blueprint $table): void {
                $table->string('ended_reason', 20)->nullable()->after('status_before_removal');
            });
        }

        if (! Schema::hasTable('audit_events')) {
            return;
        }

        $ended = DB::table('audit_events')
            ->where('action', 'crew.deleted')
            ->where('target_type', 'crew')
            ->where(fn ($why) => $why->where('reason', 'repair')->orWhere('after', 'like', '%"account_closed"%'))
            ->pluck('target_id')
            ->filter()
            ->unique()
            ->values()
            ->all();

        foreach (array_chunk($ended, 500) as $ids) {
            DB::table('crews')->whereIn('id', $ids)->whereNotNull('deleted_at')->where('status', '!=', 'removed')->whereNull('ended_reason')
                ->update(['ended_reason' => CrewEndReason::NoMembers->value]);
        }
    }

    public function down(): void
    {
        if (Schema::hasColumn('crews', 'ended_reason')) {
            Schema::table('crews', function (Blueprint $table): void {
                $table->dropColumn('ended_reason');
            });
        }
    }
};
