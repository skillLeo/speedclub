<?php

namespace App\Http\Controllers\Api\V1\Businesses;

use App\Actions\Businesses\ChangeBusinessTeam;
use App\Actions\Businesses\CreateBusiness;
use App\Actions\Businesses\ResubmitBusiness;
use App\Actions\Businesses\UpdateBusiness;
use App\Actions\Businesses\UploadBusinessMedia;
use App\Actions\Businesses\WithdrawBusiness;
use App\Enums\ErrorCode;
use App\Exceptions\ApiException;
use App\Http\Controllers\Controller;
use App\Http\Requests\Api\V1\Businesses\AddMemberRequest;
use App\Http\Requests\Api\V1\Businesses\BusinessMediaRequest;
use App\Http\Requests\Api\V1\Businesses\StoreBusinessRequest;
use App\Http\Requests\Api\V1\Businesses\UpdateBusinessRequest;
use App\Http\Resources\V1\MediaResource;
use App\Http\Resources\V1\MyBusinessResource;
use App\Http\Resources\V1\NoBusinessResource;
use App\Models\Business;
use App\Models\BusinessInvite;
use App\Models\BusinessMember;
use App\Models\User;
use App\Services\Businesses\BusinessListing;
use Illuminate\Http\Request;
use Illuminate\Http\Response;
use Illuminate\Http\UploadedFile;
use Illuminate\Support\Facades\Gate;

/**
 * The member's own business (09 §8.10): BIZ-02 Bewerbung and status, BIZ-03 dashboard, profile edits, logo and cover, team. Flag
 * `businesses`. "My business" is the one the member owns or works for; none: GET answers `data: null`, every other route 404
 * business_unavailable.
 */
class MyBusinessController extends Controller
{
    use FindsBusinesses;

    /**
     * Show my business.
     *
     * BIZ-02 status screen and BIZ-03: the profile with status, staff reason (rejected, suspended), team, open requests and the private
     * 30-day profile views. A member without a business gets 200 with `data: null` (BIZ-02 then offers the application): asking before
     * applying is no error.
     */
    public function show(Request $request, BusinessListing $listing): MyBusinessResource|NoBusinessResource
    {
        /** @var User $user */
        $user = $request->user();

        if (! BusinessMember::query()->where('user_id', $user->id)->exists()) {
            return new NoBusinessResource;
        }

        $business = $this->myBusiness($user, 'view');
        $business->portfolioCount = $listing->portfolioCount($user, $business);

        return new MyBusinessResource($business);
    }

    /**
     * Apply with a business.
     *
     * Accepts an Idempotency-Key header. BIZ-02: the business starts as `applied` and waits for staff (ADM-55); the member becomes its
     * owner. Needs a verified e-mail (403 email_not_verified); one business per member (409 business_exists). Legal forms with a
     * register entry need register court and number (422).
     */
    public function store(StoreBusinessRequest $request, CreateBusiness $action): MyBusinessResource
    {
        /** @var User $user */
        $user = $request->user();
        Gate::authorize('create', Business::class);
        $business = $action->handle($user, $request->details());
        $business->portfolioCount = 0;

        /** @status 201 */
        return new MyBusinessResource($business->load(['owner', 'logo', 'cover']));
    }

    /**
     * Change my business.
     *
     * Owner and staff. Only the keys sent change. Once verified, name, kind, legal form, representative, address, e-mail, phone,
     * website, map point and register details are locked (`locked_fields`; 422 naming the fields): they change through support.
     */
    public function update(UpdateBusinessRequest $request, UpdateBusiness $action, BusinessListing $listing): MyBusinessResource
    {
        /** @var User $user */
        $user = $request->user();
        $business = $action->handle($this->myBusiness($user), $request->details());
        $business->portfolioCount = $listing->portfolioCount($user, $business);

        return new MyBusinessResource($business->load(['owner', 'logo', 'cover']));
    }

    /**
     * Send my business again.
     *
     * The owner, after a rejection: back to staff (`applied`). Any other state: 409 conflict.
     */
    public function submit(Request $request, ResubmitBusiness $action): MyBusinessResource
    {
        /** @var User $user */
        $user = $request->user();
        $business = $action->handle($this->myBusiness($user, 'manage'));
        $business->portfolioCount = 0;

        return new MyBusinessResource($business->load(['owner', 'logo', 'cover']));
    }

    /**
     * Withdraw my application.
     *
     * The owner deletes an applied or rejected business. A verified or suspended one: 409 business_exists (through support). Answers 204.
     */
    public function destroy(Request $request, WithdrawBusiness $action): Response
    {
        /** @var User $user */
        $user = $request->user();
        $action->handle($this->myBusiness($user, 'manage'));

        return response()->noContent();
    }

    /**
     * Upload the logo.
     *
     * Accepts an Idempotency-Key header. Square, shown at 56; re-encoded without metadata, WebP variants; replaces the old one.
     */
    public function logo(BusinessMediaRequest $request, UploadBusinessMedia $action): MediaResource
    {
        return $this->upload($request, $action, 'logo');
    }

    /**
     * Upload the cover.
     *
     * Accepts an Idempotency-Key header. 16:9 on BIZ-01; re-encoded without metadata, WebP variants; replaces the old one.
     */
    public function cover(BusinessMediaRequest $request, UploadBusinessMedia $action): MediaResource
    {
        return $this->upload($request, $action, 'cover');
    }

    /**
     * Invite a team member.
     *
     * Accepts an Idempotency-Key header. Answers the business with its team and open invitations. The owner invites a member
     * (@username); SEC-414-01: they join as staff (edit the profile, decide tags) only once they accept (POST
     * me/business-invites/{invite}/accept), and hear about the invitation in the app. A member of a business already or invited already:
     * 422; at most 10 staff and open invitations together (409 limit_reached).
     */
    public function addMember(AddMemberRequest $request, ChangeBusinessTeam $team): MyBusinessResource
    {
        /** @var User $user */
        $user = $request->user();
        $business = $this->myBusiness($user, 'manage');
        $team->invite($business, $user, $request->username());
        $business->portfolioCount = null;

        return new MyBusinessResource($business);
    }

    /**
     * Remove a team member or withdraw an invitation.
     *
     * The owner removes staff or withdraws an open invitation of that member; staff may remove themselves (leave). The owner cannot be
     * removed (403). The member (or, when staff leave, the owner) hears about it. Answers 204.
     */
    public function removeMember(Request $request, string $username, ChangeBusinessTeam $team): Response
    {
        /** @var User $user */
        $user = $request->user();
        $business = $this->myBusiness($user, 'view');
        $name = mb_strtolower(ltrim($username, '@'));
        $member = BusinessMember::query()->with('user')->where('business_id', $business->id)
            ->whereHas('user', fn ($query) => $query->where('username', $name))->first();

        if (! $member instanceof BusinessMember) {
            $invite = BusinessInvite::query()->with('user')->where('business_id', $business->id)
                ->whereHas('user', fn ($query) => $query->where('username', $name))->first();

            if (! $invite instanceof BusinessInvite) {
                throw new ApiException(ErrorCode::NotFound);
            }

            Gate::forUser($user)->authorize('manage', $business);
            $team->withdraw($business, $user, $invite);

            return response()->noContent();
        }

        if ($member->user_id !== $user->id) {
            Gate::forUser($user)->authorize('manage', $business);
        }

        $team->remove($business, $user, $member);

        return response()->noContent();
    }

    /**
     * @param  'logo'|'cover'  $slot
     */
    private function upload(BusinessMediaRequest $request, UploadBusinessMedia $action, string $slot): MediaResource
    {
        /** @var User $user */
        $user = $request->user();
        $business = $this->myBusiness($user);
        $file = $request->file('file');
        abort_unless($file instanceof UploadedFile, 422);

        /** @var array{alt?: string|null, focal_x?: float|null, focal_y?: float|null} $attributes */
        $attributes = array_intersect_key($request->validated(), array_flip(['alt', 'focal_x', 'focal_y']));

        /** @status 201 */
        return new MediaResource($action->handle($user, $business, $slot, $file, $attributes));
    }
}
