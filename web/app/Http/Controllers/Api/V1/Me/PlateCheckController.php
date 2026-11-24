<?php

namespace App\Http\Controllers\Api\V1\Me;

use App\Actions\Media\DismissPlateCheck;
use App\Actions\Media\KeepPlateCheckPhoto;
use App\Enums\ErrorCode;
use App\Exceptions\ApiException;
use App\Http\Controllers\Controller;
use App\Http\Requests\Api\V1\Me\PlateCheckDecisionRequest;
use App\Http\Requests\Api\V1\Me\PlateCheckIndexRequest;
use App\Http\Resources\V1\PlateCheckItemResource;
use App\Models\User;
use App\Services\Media\PlateCheck;
use Illuminate\Http\Request;
use Illuminate\Http\Resources\Json\AnonymousResourceCollection;
use Illuminate\Http\Response;
use Illuminate\Support\Facades\Gate;

/**
 * M5.9a "Kennzeichen prüfen" (GAR-01 card, m5.9a-contract §4): the one-time check of the member's photos from before the plate switch.
 */
class PlateCheckController extends Controller
{
    /**
     * List my photos to check for number plates.
     *
     * The member's own finished photos of vehicles, modifications and build updates, and the profile cover, that were uploaded without a
     * plate decision (`plate_blur.state` `unchecked`); newest first, cursor pages of 25. `meta.count` is the number of all of them,
     * `meta.dismissed` whether the member said "Später": the garage card shows while `count > 0` and not `dismissed`. Chat photos are
     * never listed.
     */
    public function index(PlateCheckIndexRequest $request, PlateCheck $check): AnonymousResourceCollection
    {
        $member = $this->member($request);
        $page = $check->listing($member)->cursorPaginate($request->pageSize())->withQueryString();

        return PlateCheckItemResource::collection($page)->additional(['meta' => [
            'count' => $check->pending($member)->count(),
            'dismissed' => $member->getAttribute('plate_check_dismissed_at') !== null,
        ]]);
    }

    /**
     * Keep a photo as it is.
     *
     * "Kein Kennzeichen sichtbar": the photo stays unchanged and leaves the list (`plate_blur.state` `declined`). To pixelate instead,
     * send `blur_regions` to `PATCH media/{media}`. Idempotent: a photo decided already (kept, or pixelated) stays as it is and answers
     * 204 too. Accepts an Idempotency-Key header. 404 for a photo the check does not cover (another member's, a chat photo, the avatar).
     */
    public function decide(PlateCheckDecisionRequest $request, string $media, PlateCheck $check, KeepPlateCheckPhoto $action): Response
    {
        $found = $check->find($this->member($request), $media) ?? throw new ApiException(ErrorCode::NotFound);

        Gate::authorize('update', $found);

        $action->handle($found);

        return response()->noContent();
    }

    /**
     * Dismiss the plate check.
     *
     * "Später": the garage card does not come back (`meta.dismissed`). The photos keep their state; nothing changes on them. Accepts an
     * Idempotency-Key header.
     */
    public function dismiss(Request $request, DismissPlateCheck $action): Response
    {
        $member = $this->member($request);

        Gate::authorize('updateProfile', $member);

        $action->handle($member);

        return response()->noContent();
    }

    private function member(Request $request): User
    {
        /** @var User $member */
        $member = $request->user();

        return $member;
    }
}
