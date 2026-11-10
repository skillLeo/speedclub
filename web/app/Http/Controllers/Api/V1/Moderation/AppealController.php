<?php

namespace App\Http\Controllers\Api\V1\Moderation;

use App\Actions\Moderation\FileAppeal;
use App\Enums\ErrorCode;
use App\Exceptions\ApiException;
use App\Http\Controllers\Controller;
use App\Http\Requests\Api\V1\Moderation\StoreAppealRequest;
use App\Http\Resources\V1\AppealResource;
use App\Models\Decision;
use App\Models\User;
use App\Services\Moderation\DecisionAudience;
use Illuminate\Support\Facades\Gate;

/**
 * The internal complaint (Art. 20 DSA, SAFE-01 "Einspruch einlegen"): the affected member and every member who reported the case.
 */
class AppealController extends Controller
{
    /**
     * Appeal a decision.
     *
     * 10 a day (`throttle:appeals`); send an `Idempotency-Key`. Within `appeal_until`, else 422 `appeal_period_over`; one appeal per
     * member and decision, a second is 409 `appeal_exists`. Anybody the decision does not concern, and an unknown id, get 404 `not_found`.
     */
    public function store(StoreAppealRequest $request, string $decision, DecisionAudience $audience, FileAppeal $action): AppealResource
    {
        Gate::authorize('viewAny', Decision::class);

        /** @var User $user */
        $user = $request->user();
        $found = preg_match('/\A[0-9A-HJKMNP-TV-Za-hjkmnp-tv-z]{26}\z/', $decision) === 1 ? Decision::query()->find(strtolower($decision)) : null;
        $role = $found === null ? null : $audience->roleOf($user, $found);

        if ($found === null || $role === null) {
            throw new ApiException(ErrorCode::NotFound);
        }

        /** @status 201 */
        return new AppealResource($action->handle($user, $found, $role, $request->text()));
    }
}
