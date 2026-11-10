<?php

namespace App\Http\Controllers\Admin\Moderation;

use App\Enums\CaseStatus;
use App\Enums\ReportTargetType;
use App\Http\Controllers\Admin\Support\QaClock;
use App\Http\Controllers\Admin\Support\TableProps;
use App\Http\Controllers\Controller;
use App\Models\ModerationCase;
use App\Models\Report;
use App\Models\Staff;
use App\Models\User;
use App\Services\Moderation\CaseRecord;
use App\Services\Moderation\SorTemplates;
use Illuminate\Http\Request;
use Inertia\Inertia;
use Inertia\Response;

/**
 * ADM-22 messaging safety (m3.4-contract §2, `moderation.messages`): reported message cases only, open or decided; the selected case
 * shows its participants (usernames), report reasons, decision and the composer. The reported message and its context are not props:
 * the page asks CaseJsonController::evidence when the case opens, audited each time.
 */
class MessageCasesController extends Controller
{
    public function __invoke(Request $request, CaseRecord $record): Response
    {
        /** @var Staff $staff */
        $staff = $request->user('staff');
        $tab = $request->query('tab') === 'decided' ? 'decided' : 'open';
        $now = QaClock::now($request);
        $selected = is_string($request->query('case')) ? CaseRecord::find($request->query('case'), $now) : null;

        if ($selected !== null && $selected->target_type !== ReportTargetType::Message) {
            $selected = null;
        }

        return Inertia::render('Moderation/Messages', [
            ...TableProps::make(CaseListQuery::build($request, $staff, $tab, $now, messagesOnly: true), $request, 'moderation-messages-'.$tab, $staff, fn (array $cases): array => self::withReporter(CaseListQuery::rows($cases, $staff)), CaseListQuery::defaultSort($tab === 'open' ? 'new' : 'decided')),
            'tab' => $tab,
            'counts' => fn (): array => [
                'open' => ModerationCase::query()->where('target_type', ReportTargetType::Message->value)->whereIn('status', [CaseStatus::New->value, CaseStatus::InReview->value])->count(),
                'decided' => ModerationCase::query()->where('target_type', ReportTargetType::Message->value)->whereIn('status', [CaseStatus::Decided->value, CaseStatus::Closed->value])->count(),
            ],
            'selected' => $selected === null ? null : [
                'case' => $record->summary($selected, $staff),
                'reports' => $record->reports($selected, $staff),
                'decision' => $record->decision($selected, $staff),
                'prior' => $record->prior($selected),
                'composer' => $record->composer($selected, $staff),
            ],
            'templates' => fn (): array => $staff->can('moderation.decide') ? SorTemplates::all() : [],
        ]);
    }

    /**
     * DQ-598: the split list names both participants ("@marco.amg → @aylin.vtec"), so each row carries the username of the member who
     * reported it first (the other side of the conversation); null for a deleted account or a report without one.
     *
     * @param  list<array<string, mixed>>  $rows
     * @return list<array<string, mixed>>
     */
    private static function withReporter(array $rows): array
    {
        $ids = array_map(fn (array $row): string => (string) $row['id'], $rows);
        $reporters = [];

        foreach (Report::query()->with('reporter:id,username,deleted_at')->whereIn('case_id', $ids === [] ? ['-'] : $ids)->whereNotNull('reporter_id')
            ->orderBy('created_at')->orderBy('id')->get(['id', 'case_id', 'reporter_id', 'created_at']) as $report) {
            $member = $report->reporter;
            $reporters[$report->case_id] ??= $member instanceof User && $member->deleted_at === null ? $member->username : null;
        }

        return array_map(fn (array $row): array => [...$row, 'reporter' => $reporters[$row['id']] ?? null], $rows);
    }
}
