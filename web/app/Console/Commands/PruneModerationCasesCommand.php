<?php

namespace App\Console\Commands;

use App\Enums\AppealStatus;
use App\Enums\CaseStatus;
use App\Models\ModerationCase;
use App\Services\Privacy\RetentionPolicy;
use Carbon\CarbonImmutable;
use Illuminate\Console\Attributes\Description;
use Illuminate\Console\Attributes\Signature;
use Illuminate\Console\Command;
use Illuminate\Database\Query\Builder;
use Illuminate\Support\Facades\DB;

/**
 * ADR-239 / 06 §4 `moderation_cases` (36 months, RetentionPolicy; OA-17 for the lawyer): a closed or decided case goes, with its reports,
 * decisions (and their statements of reasons) and appeals (foreign-key cascades), once nothing about it happened for that long. Kept as
 * long as redress needs it (08 §4): never an open case, never one with an open appeal, never one with a decision of the last 6 months
 * (the appeal window) or of the retention period, and never one whose appeal is under review in another case that is itself kept.
 * The audit log keeps its own rows (append-only, ADR-013). A batch a day; a backlog clears over the following days.
 */
#[Signature('moderation:prune')]
#[Description('Delete closed moderation cases, their reports, decisions and appeals after the retention period')]
class PruneModerationCasesCommand extends Command
{
    private const BATCH = 500;

    /** 08 §4: an appeal is possible for 6 months after the decision. */
    private const APPEAL_WINDOW_MONTHS = 6;

    public function handle(RetentionPolicy $retention): int
    {
        $now = CarbonImmutable::now();
        $cutoff = $now->subMonthsNoOverflow($retention->fixed('moderation_cases') ?? 36);
        // The earlier of the two: whichever keeps more.
        $decisionCutoff = $cutoff->min($now->subMonthsNoOverflow(self::APPEAL_WINDOW_MONTHS));

        $ids = $this->prunable($cutoff, $decisionCutoff)->limit(self::BATCH)->pluck('moderation_cases.id')->all();
        $deleted = $ids === [] ? 0 : DB::transaction(fn (): int => ModerationCase::query()->whereKey($ids)->delete());

        $this->info("Deleted {$deleted} moderation cases after the retention period.");

        return self::SUCCESS;
    }

    private function prunable(CarbonImmutable $cutoff, CarbonImmutable $decisionCutoff): Builder
    {
        $open = [CaseStatus::New->value, CaseStatus::InReview->value];

        return DB::table('moderation_cases')
            ->whereIn('moderation_cases.status', [CaseStatus::Decided->value, CaseStatus::Closed->value])
            ->where('moderation_cases.created_at', '<', $cutoff)
            ->where(fn (Builder $q) => $q->whereNull('moderation_cases.decided_at')->orWhere('moderation_cases.decided_at', '<', $cutoff))
            ->whereNotExists(fn (Builder $q) => $q->from('reports')->whereColumn('reports.case_id', 'moderation_cases.id')->where('reports.created_at', '>=', $cutoff))
            ->whereNotExists(fn (Builder $q) => $q->from('decisions')->whereColumn('decisions.case_id', 'moderation_cases.id')
                ->where(fn (Builder $w) => $w->whereNull('decisions.decided_at')->orWhere('decisions.decided_at', '>=', $decisionCutoff)))
            ->whereNotExists(fn (Builder $q) => $q->from('appeals')->join('decisions', 'decisions.id', '=', 'appeals.decision_id')
                ->whereColumn('decisions.case_id', 'moderation_cases.id')
                ->where(fn (Builder $w) => $w->where('appeals.status', AppealStatus::Open->value)
                    ->orWhere('appeals.created_at', '>=', $cutoff)
                    ->orWhere('appeals.decided_at', '>=', $cutoff)))
            // An appeal of this case's decision that another case reviews: kept while that case is open or recent.
            ->whereNotExists(fn (Builder $q) => $q->from('moderation_cases as review')
                ->join('appeals', 'appeals.id', '=', 'review.appeal_id')
                ->join('decisions', 'decisions.id', '=', 'appeals.decision_id')
                ->whereColumn('decisions.case_id', 'moderation_cases.id')
                ->where(fn (Builder $w) => $w->whereIn('review.status', $open)
                    ->orWhere('review.created_at', '>=', $cutoff)
                    ->orWhere('review.decided_at', '>=', $cutoff)))
            ->orderBy('moderation_cases.created_at')
            ->select('moderation_cases.id');
    }
}
