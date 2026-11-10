<?php

namespace App\Http\Controllers\Admin\Moderation;

use App\Enums\AppealStatus;
use App\Http\Controllers\Admin\Support\QaClock;
use App\Http\Controllers\Admin\Support\TableProps;
use App\Http\Controllers\Controller;
use App\Models\Appeal;
use App\Models\ModerationCase;
use App\Models\Staff;
use App\Services\AppConfig\FeatureFlags;
use Illuminate\Http\Request;
use Inertia\Inertia;
use Inertia\Response;

/**
 * ADM-20 moderation queue (m3.4-contract §2): tabs Neu · In Prüfung · Entschieden · Einsprüche, the priority with its parts, the [AI]
 * score slot (only with `ai.moderation_triage`), "Übernehmen" and the bulk "Keine Maßnahme" with its result panel.
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
            : TableProps::make(CaseListQuery::build($request, $staff, $tab, $now), $request, 'moderation-'.$tab, $staff, fn (array $cases): array => CaseListQuery::rows($cases, $staff), CaseListQuery::defaultSort($tab));

        return Inertia::render('Moderation/Reports', [
            ...$table,
            'tab' => $tab,
            'counts' => fn (): array => [...CaseListQuery::counts(), 'appeals' => Appeal::query()->where('status', AppealStatus::Open)->count()],
            'aiTriage' => $flags->enabled('ai.moderation_triage'),
            'bulkResult' => fn (): ?array => self::bulkResult($request),
        ]);
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
