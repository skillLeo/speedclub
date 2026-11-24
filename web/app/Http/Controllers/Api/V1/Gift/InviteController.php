<?php

namespace App\Http\Controllers\Api\V1\Gift;

use App\Enums\ErrorCode;
use App\Exceptions\ApiException;
use App\Http\Controllers\Controller;
use App\Http\Resources\V1\InviteLookupResource;
use App\Http\Resources\V1\InviteResource;
use App\Models\InviteCode;
use App\Models\User;
use App\Services\Invites\InviteCodes;
use Illuminate\Http\Request;
use Illuminate\Http\Resources\Json\AnonymousResourceCollection;
use Illuminate\Support\Facades\Gate;

class InviteController extends Controller
{
    /**
     * My invite codes.
     *
     * M5.9d (m5.9d contract §5, §10.4): five codes (8 characters Crockford), created on the first read, oldest first; each open or redeemed
     * (`accepted_at`, `accepted_by` while the member may be seen). Redeemed codes are not replaced. Both sides of a redeemed code get the
     * "Crew Starter" badge and nothing else. 403 for a member without a username (nobody could see who invites).
     */
    public function index(Request $request, InviteCodes $invites): AnonymousResourceCollection
    {
        Gate::authorize('viewAny', InviteCode::class);
        /** @var User $user */
        $user = $request->user();

        return InviteResource::collection($invites->for($user));
    }

    /**
     * Look up an invite code.
     *
     * M5.9d (contract §10.4): an open code and its inviter for the sign-up screens ("Du wurdest von @… eingeladen"). 404 `not_found` for
     * an unknown, used or no longer valid code (the inviter deleted, suspended or unverified). Lower-case and the look-alikes I, L, O are
     * read as their Crockford digits. Throttled per IP.
     *
     * @unauthenticated
     */
    public function show(string $code, InviteCodes $invites): InviteLookupResource
    {
        $invite = $invites->open(InviteCodes::normalize($code)) ?? throw new ApiException(ErrorCode::NotFound);

        return new InviteLookupResource($invite);
    }
}
