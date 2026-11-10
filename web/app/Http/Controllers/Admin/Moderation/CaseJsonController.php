<?php

namespace App\Http\Controllers\Admin\Moderation;

use App\Actions\Admin\Moderation\RevealReportContact;
use App\Enums\DecisionAction;
use App\Enums\DecisionRestriction;
use App\Http\Controllers\Admin\Moderation\Requests\PreviewStatementRequest;
use App\Http\Controllers\Admin\Support\QaClock;
use App\Http\Controllers\Controller;
use App\Models\Report;
use App\Models\Staff;
use App\Services\Moderation\CaseEvidence;
use App\Services\Moderation\CaseRecord;
use App\Services\Moderation\StatementPreview;
use Carbon\CarbonImmutable;
use Illuminate\Auth\Access\AuthorizationException;
use Illuminate\Http\JsonResponse;
use Illuminate\Http\Request;

/**
 * ADM-21/22 answers that must never sit in a page prop (like MemberJsonController): the evidence of a case (encrypted report snapshots,
 * for a message the reported message and its stored context) and on request up to ±10 live messages around it, each opening audited by
 * CaseEvidence; a web notifier's address (SEC-P3-25, RevealReportContact); and the DE/EN preview of what the member would read. Plain JSON, no-store, refused to an Inertia visit (409).
 */
class CaseJsonController extends Controller
{
    public function evidence(Request $request, string $case, CaseEvidence $evidence): JsonResponse
    {
        self::refuseInertia($request);

        try {
            return self::json($evidence->reveal(CaseActionsController::case($case), self::staff($request)));
        } catch (AuthorizationException) {
            abort(403);
        }
    }

    public function live(Request $request, string $case, CaseEvidence $evidence): JsonResponse
    {
        self::refuseInertia($request);

        try {
            return self::json(['messages' => $evidence->live(CaseActionsController::case($case), self::staff($request))]);
        } catch (AuthorizationException) {
            abort(403);
        }
    }

    /** SEC-P3-25: the full address of a web-form notifier (members.view_pii), audited and within the daily cap of reveals. */
    public function contact(Request $request, string $case, string $report, RevealReportContact $reveal): JsonResponse
    {
        self::refuseInertia($request);

        try {
            return self::json($reveal->handle(self::staff($request), CaseActionsController::case($case), $report));
        } catch (AuthorizationException) {
            abort(403);
        }
    }

    public function preview(PreviewStatementRequest $request, string $case): JsonResponse
    {
        self::refuseInertia($request);
        // A side request: it must not use up the one-time flash a decision just left for the next page (the session ages flash data at
        // the end of every request, so it is kept for one more; nothing here reads or adds a flash).
        if ($request->hasSession()) {
            $request->session()->reflash();
        }
        $row = CaseActionsController::case($case);
        $action = DecisionAction::from($request->string('action')->value());
        $until = $request->input('until');
        $restriction = match ($action) {
            DecisionAction::Restrict => DecisionRestriction::tryFrom($request->string('restriction')->value()),
            DecisionAction::Suspend => DecisionRestriction::Suspension,
            default => null,
        };
        $label = $row->target_label ?? Report::query()->where('case_id', $row->id)->orderBy('created_at')->value('target_label');

        return self::json(StatementPreview::render(
            $action,
            $restriction,
            is_string($until) && $until !== '' ? CarbonImmutable::parse($until) : null,
            $request->string('facts')->value(),
            $request->string('ground')->value(),
            CaseRecord::automatedDetection($row),
            $row->isOwnInitiative(),
            $row->target_type,
            is_string($label) ? $label : null,
            QaClock::now($request),
        ));
    }

    private static function staff(Request $request): Staff
    {
        /** @var Staff $staff */
        $staff = $request->user('staff');

        return $staff;
    }

    private static function refuseInertia(Request $request): void
    {
        abort_if($request->header('X-Inertia') !== null, 409);
    }

    /**
     * @param  array<string, mixed>  $data
     */
    private static function json(array $data): JsonResponse
    {
        return response()->json($data, 200, ['Cache-Control' => 'no-store, private', 'Pragma' => 'no-cache']);
    }
}
