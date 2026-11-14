<?php

namespace App\Http\Controllers\Admin\Moderation;

use App\Enums\AppealStatus;
use App\Enums\ReportTargetType;
use App\Http\Controllers\Admin\Support\QaClock;
use App\Http\Controllers\Admin\Support\TableProps;
use App\Http\Controllers\Controller;
use App\Models\Appeal;
use App\Models\ModerationCase;
use App\Models\Staff;
use App\Services\AppConfig\FeatureFlags;
use App\Services\Moderation\CaseRecord;
use App\Services\Moderation\SorTemplates;
use Carbon\CarbonImmutable;
use Illuminate\Http\Request;
use Inertia\Inertia;
use Inertia\Response;

/**
 * ADM-20 moderation queue (m3.4-contract §2): tabs Neu · In Prüfung · Entschieden · Einsprüche, the priority with its parts, the [AI]
 * score slot (only with `ai.moderation_triage`), "Übernehmen" and the bulk "Keine Maßnahme" with its result panel.
 *
 * M4.17 SplitQueue (09 §10.2): `?case=<id>` opens that case in the right pane (`selected`: what ADM-21 shows for a decision, the composer
 * options and the SoR templates; message content never), `decided` / `taken` are this session's last decision and take (toast, undo of
 * the take, auto-advance). The decision itself keeps every DSA step of ADM-21: composer, statement of reasons, reason, password,
 * four-eyes for a suspension.
 */
class ReportsQueueController extends Controller
{
    public const TABS = ['new', 'in_review', 'decided', 'appeals'];

    public function __invoke(Request $request, FeatureFlags $flags): Response
    {
        /** @var Staff $staff */
        $staff = $request->user('staff');
        $tab = $request->query('tab');
        $tab = is_string($tab) && in_array($tab, self::TABS, true) ? $tab : 'new';
        $now = QaClock::now($request);

        $table = $tab === 'appeals'
            ? TableProps::make(AppealListQuery::build($request), $request, AppealListQuery::TABLE, $staff, fn (array $appeals): array => AppealListQuery::rows($appeals, $staff), AppealListQuery::DEFAULT_SORT)
            : TableProps::make(CaseListQuery::build($request, $staff, $tab, $now), $request, 'moderation-'.$tab, $staff, fn (array $cases): array => CaseListQuery::rows($cases, $staff, $now), CaseListQuery::defaultSort($tab));

        return Inertia::render('Moderation/Reports', [
            ...$table,
            'tab' => $tab,
            'counts' => fn (): array => [...CaseListQuery::counts(), 'appeals' => Appeal::query()->where('status', AppealStatus::Open)->count()],
            'aiTriage' => $flags->enabled('ai.moderation_triage'),
            'bulkResult' => fn (): ?array => self::bulkResult($request),
            'selected' => fn (): ?array => self::selected($request, $staff, $now, $flags),
            'decided' => fn (): mixed => $request->session()->get(CaseActionsController::DECIDED),
            'taken' => fn (): mixed => $request->session()->get(CaseActionsController::TAKEN),
        ]);
    }

    /**
     * The case of `?case=` for the pane, or null for an unknown one (the pane says "gone").
     *
     * @return array<string, mixed>|null
     */
    private static function selected(Request $request, Staff $staff, CarbonImmutable $now, FeatureFlags $flags): ?array
    {
        $id = $request->query('case');

        if (! is_string($id) || preg_match('/^[0-9A-Za-z]{26}$/', $id) !== 1) {
            return null;
        }

        $row = CaseRecord::find($id, $now);

        if ($row === null) {
            return null;
        }

        $record = app(CaseRecord::class);
        $message = $row->target_type === ReportTargetType::Message;

        return [
            'case' => $record->summary($row, $staff),
            'preview' => $message ? null : $record->preview($row),
            'reports' => $record->reports($row, $staff),
            'decision' => $record->decision($row, $staff),
            'composer' => $record->composer($row, $staff),
            'templates' => $staff->can('moderation.decide') ? SorTemplates::all() : [],
            'messageCase' => $message,
            'ai' => $flags->enabled('ai.moderation_triage') && $row->ai_score !== null ? ['score' => round((float) $row->ai_score, 2), 'summary' => $row->ai_summary] : null,
        ];
    }

    /**
     * @return array{rows: list<array{id: string, ok: bool, code: string|null}>, labels: array<string, string>}|null
     */
    private static function bulkResult(Request $request): ?array
    {
        $result = $request->hasSession() ? $request->session()->get(ReportsBulkController::FLASH) : null;

        if (! is_array($result) || ! is_array($result['rows'] ?? null)) {
            return null;
        }

        /** @var list<array{id: string, ok: bool, code: string|null}> $rows */
        $rows = array_values($result['rows']);
        $labels = ModerationCase::query()->whereIn('id', array_column($rows, 'id'))->pluck('id')
            ->mapWithKeys(fn (mixed $id): array => [(string) $id => strtoupper(substr((string) $id, -8))])->all();

        return ['rows' => $rows, 'labels' => $labels];
    }
}
