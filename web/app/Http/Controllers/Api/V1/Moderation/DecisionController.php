<?php

namespace App\Http\Controllers\Api\V1\Moderation;

use App\Enums\DecisionAction;
use App\Enums\ErrorCode;
use App\Exceptions\ApiException;
use App\Http\Controllers\Controller;
use App\Http\Requests\Api\V1\Moderation\OwnSafetyListRequest;
use App\Http\Resources\V1\DecisionResource;
use App\Http\Resources\V1\DecisionSummaryResource;
use App\Models\Appeal;
use App\Models\Decision;
use App\Models\User;
use App\Services\Moderation\DecisionAudience;
use Illuminate\Http\Request;
use Illuminate\Http\Resources\Json\AnonymousResourceCollection;
use Illuminate\Support\Facades\Gate;

/**
 * Decisions a member may read (SAFE-01, SET-16): those that restricted them and the outcome of cases they reported. Open under every
 * restriction and a suspension (Art. 17, 20 DSA); a deactivated account gets 403 before any lookup.
 */
class DecisionController extends Controller
{
    public function __construct(private readonly DecisionAudience $audience) {}

    /**
     * Decisions about my content or account (SET-16 "Entscheidungen zu deinen Inhalten").
     *
     * Newest first; only decisions that restricted the member (a no_action was never theirs to read), each with their own appeal
     * status.
     */
    public function index(OwnSafetyListRequest $request): AnonymousResourceCollection
    {
        Gate::authorize('viewAny', Decision::class);

        /** @var User $user */
        $user = $request->user();

        return DecisionSummaryResource::collection(
            Decision::query()
                ->where('subject_id', $user->id)
                ->where('action', '!=', DecisionAction::NoAction->value)
                ->with(['case.firstReport', 'appeals' => fn ($query) => $query->where('appellant_id', $user->id)])
                ->orderByDesc('decisions.decided_at')
                ->orderByDesc('decisions.id')
                ->cursorPaginate($request->pageSize())
                ->withQueryString()
        );
    }

    /**
     * A decision (SAFE-01).
     *
     * `viewer: affected` gets the full statement of reasons; `viewer: reporter` the outcome only. Any other member, and an unknown id,
     * get the same 404 `not_found`.
     */
    public function show(Request $request, string $decision): DecisionResource
    {
        Gate::authorize('viewAny', Decision::class);

        /** @var User $user */
        $user = $request->user();
        $found = $this->find($decision);
        $role = $found === null ? null : $this->audience->roleOf($user, $found);

        if ($found === null || $role === null) {
            throw new ApiException(ErrorCode::NotFound);
        }

        $appeal = Appeal::query()->where('decision_id', $found->id)->where('appellant_id', $user->id)->first();

        return new DecisionResource($found, $role, $appeal);
    }

    private function find(string $id): ?Decision
    {
        return preg_match('/\A[0-9A-HJKMNP-TV-Za-hjkmnp-tv-z]{26}\z/', $id) === 1
            ? Decision::query()->with('case.firstReport')->find(strtolower($id))
            : null;
    }
}
