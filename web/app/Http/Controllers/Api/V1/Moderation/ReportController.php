<?php

namespace App\Http\Controllers\Api\V1\Moderation;

use App\Actions\Moderation\SubmitReport;
use App\Http\Controllers\Controller;
use App\Http\Requests\Api\V1\Moderation\OwnSafetyListRequest;
use App\Http\Requests\Api\V1\Moderation\StoreReportRequest;
use App\Http\Resources\V1\ReportReceiptResource;
use App\Http\Resources\V1\ReportSummaryResource;
use App\Models\Report;
use App\Models\User;
use App\Services\Moderation\ReportTargets;
use Illuminate\Http\Resources\Json\AnonymousResourceCollection;
use Illuminate\Support\Facades\Gate;

/**
 * DSA notice and action in the app (Art. 16, m2.6-contract §2). Members only; guests report on the web (WEB-09 /melden). A safety tool:
 * open before verification, under restrictions and a suspension; a deactivated account gets 403 before any lookup.
 */
class ReportController extends Controller
{
    /**
     * Report a member, build, photo, message, build update or modification.
     *
     * 20 a day (`throttle:reports`); send an `Idempotency-Key`: a retry of the same report answers its first 201. `target_id` is the
     * username of a member, the ULID of anything else. A target the reporter cannot see (unknown, hidden, across a block) is 404
     * `not_found`; their own profile or content 422 `own_content`; a second report of a target whose case is still open 409
     * `already_reported`. A message stays reportable for a participant after a block, so "Blockieren & melden" works in either order.
     */
    public function store(StoreReportRequest $request, ReportTargets $targets, SubmitReport $action): ReportReceiptResource
    {
        Gate::authorize('create', Report::class);

        /** @var User $user */
        $user = $request->user();
        $target = $targets->forMember($user, $request->targetType(), $request->targetId());

        /** @status 201 */
        return new ReportReceiptResource($action->handle($target, $request->draft()));
    }

    /**
     * My reports (SET-16 "Meine Meldungen").
     *
     * Newest first. Each row has the status of its case (received, in_review, decided) and, once decided, the decision with the
     * viewer's own appeal status; it opens SAFE-01.
     */
    public function index(OwnSafetyListRequest $request): AnonymousResourceCollection
    {
        Gate::authorize('viewAny', Report::class);

        /** @var User $user */
        $user = $request->user();

        return ReportSummaryResource::collection(
            Report::query()
                ->where('reporter_id', $user->id)
                ->with(['case.decision.appeals' => fn ($query) => $query->where('appellant_id', $user->id)])
                ->orderByDesc('reports.created_at')
                ->orderByDesc('reports.id')
                ->cursorPaginate($request->pageSize())
                ->withQueryString()
        );
    }
}
