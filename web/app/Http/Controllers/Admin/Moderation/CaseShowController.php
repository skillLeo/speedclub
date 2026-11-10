<?php

namespace App\Http\Controllers\Admin\Moderation;

use App\Enums\ReportTargetType;
use App\Http\Controllers\Admin\Support\QaClock;
use App\Http\Controllers\Controller;
use App\Models\Staff;
use App\Services\AppConfig\FeatureFlags;
use App\Services\Moderation\CaseRecord;
use App\Services\Moderation\SorTemplates;
use Illuminate\Http\Request;
use Inertia\Inertia;
use Inertia\Response;

/**
 * ADM-21 case (m3.4-contract §2): the case, the target as members see it, all reports, the decision with its appeals, the member's
 * earlier decisions, the history from the audit log and the composer (templates, placeholders, allowed actions). Message content is
 * never a prop: a message case shows no preview, and its evidence comes only through the audited CaseJsonController (ADM-22).
 */
class CaseShowController extends Controller
{
    public function __invoke(Request $request, string $case, CaseRecord $record, FeatureFlags $flags): Response
    {
        /** @var Staff $staff */
        $staff = $request->user('staff');
        $row = CaseRecord::find($case, QaClock::now($request));
        abort_if($row === null, 404);

        return Inertia::render('Moderation/Case', [
            'case' => fn (): array => $record->summary($row, $staff),
            'preview' => fn (): ?array => $record->preview($row),
            'reports' => fn (): array => $record->reports($row, $staff),
            'decision' => fn (): ?array => $record->decision($row, $staff),
            'prior' => fn (): array => $record->prior($row),
            'activity' => fn (): array => $record->history($row, $staff),
            'composer' => fn (): array => $record->composer($row, $staff),
            'templates' => fn (): array => $staff->can('moderation.decide') || $staff->can('moderation.appeals') ? SorTemplates::all() : [],
            'staffOptions' => fn (): array => $staff->can('moderation.decide') ? self::colleagues() : [],
            'messageCase' => $row->target_type === ReportTargetType::Message,
            // M3.7 [AI] "KI-Vorschlag" (ai.moderation_triage): the triage's score and reason, a suggestion that never decides (ADR-243).
            'ai' => fn (): ?array => $flags->enabled('ai.moderation_triage') && $row->ai_score !== null
                ? ['score' => round((float) $row->ai_score, 2), 'summary' => $row->ai_summary]
                : null,
        ]);
    }

    /**
     * Active staff who may take a case.
     *
     * @return list<array{id: int, name: string}>
     */
    public static function colleagues(): array
    {
        return array_values(Staff::permission('moderation.decide')->where('status', 'active')->orderBy('name')->orderBy('id')->get(['id', 'name'])
            ->map(fn (Staff $staff): array => ['id' => $staff->id, 'name' => $staff->name])->all());
    }
}
