<?php

namespace App\Http\Controllers\Api\V1\Events;

use App\Actions\Events\Gallery\DeleteEventPhoto;
use App\Actions\Events\Gallery\ReviewEventPhoto;
use App\Actions\Events\Gallery\UploadEventPhoto;
use App\Enums\ErrorCode;
use App\Enums\GalleryPhotoStatus;
use App\Exceptions\ApiException;
use App\Http\Controllers\Controller;
use App\Http\Requests\Api\V1\Events\EventGalleryRequest;
use App\Http\Requests\Api\V1\Events\RejectEventPhotoRequest;
use App\Http\Requests\Api\V1\Events\StoreEventPhotoRequest;
use App\Http\Resources\V1\EventPhotoResource;
use App\Models\Event;
use App\Models\EventPhoto;
use App\Models\User;
use App\Services\Events\EventGallery;
use App\Support\Viewer;
use Illuminate\Http\JsonResponse;
use Illuminate\Http\Request;
use Illuminate\Http\Resources\Json\AnonymousResourceCollection;
use Illuminate\Http\Response;
use Illuminate\Http\UploadedFile;
use Illuminate\Support\Facades\Gate;

/**
 * M5.6 post-event gallery (10 §4, m5.6-contract §4; flags `events` + `events.gallery`). Everybody who may see the event reads the
 * approved photos; the organiser approves attendees' photos first, staff act through the `photo` reports of the photos' media.
 */
class EventGalleryController extends Controller
{
    use FindsEvents;

    /**
     * List the gallery.
     *
     * Guests too for `status=approved` (default, approval order). `status=pending`: the organiser's queue (401 for guests, 403 forbidden
     * for everybody else). `status=mine`: the reader's own uploads in every status (401 for guests). Photos of members with a block
     * either way are left out.
     *
     * @unauthenticated
     */
    public function index(EventGalleryRequest $request, string $slug, EventGallery $gallery): AnonymousResourceCollection
    {
        $viewer = Viewer::from($request);
        $event = $this->findEvent($slug, $viewer);
        $status = $request->status();

        if ($status !== 'approved' && $viewer === null) {
            throw new ApiException(ErrorCode::Unauthenticated);
        }

        if ($status === 'pending' && ($viewer === null || ! Gate::forUser($viewer)->allows('moderatePhotos', $event))) {
            throw new ApiException(ErrorCode::Forbidden);
        }

        $query = match ($status) {
            'pending' => $gallery->photos($event, $viewer)->where('event_photos.status', GalleryPhotoStatus::Pending->value),
            'mine' => EventPhoto::query()->where('event_photos.event_id', $event->id)->where('event_photos.uploader_id', $viewer?->id)
                ->where('event_photos.status', '!=', GalleryPhotoStatus::Removed->value),
            default => $gallery->approved($event, $viewer),
        };
        $query = $status === 'approved'
            ? $query->orderBy('event_photos.sort')->orderBy('event_photos.id')
            : $query->orderBy('event_photos.created_at')->orderBy('event_photos.id');

        $page = $query->with(['media', 'uploader.avatar'])->cursorPaginate($request->pageSize())->withQueryString();

        foreach ($page->items() as $photo) {
            $photo->setRelation('event', $event);
        }

        return EventPhotoResource::collection($page);
    }

    /**
     * Add a photo.
     *
     * Accepts an Idempotency-Key header. Multipart `file` (JPEG, PNG or WebP, at most 15 MB, the shorter side at least 800 px),
     * `plate_blur` (required) with `blur_regions`, optional `alt`. The organiser's photo is approved at once, an attendee's (going or
     * checked in) is pending until the organiser decides. Outside the window (start … end + 14 days): 403 gallery_closed with
     * `meta.opens_at`/`meta.closes_at`; neither organiser nor going nor checked in: 403 gallery_not_attendee; 10 photos per attendee, 40
     * for the organiser, 200 per event: 409 limit_reached.
     */
    public function store(StoreEventPhotoRequest $request, string $slug, UploadEventPhoto $action): JsonResponse
    {
        /** @var User $user */
        $user = $request->user();
        $event = $this->findEvent($slug, $user);

        if (! $user->isActive()) {
            throw new ApiException(ErrorCode::Forbidden);
        }

        $file = $request->file('file');
        abort_unless($file instanceof UploadedFile, 422);

        /** @status 201 */
        return (new EventPhotoResource($action->handle($user, $event, $file, $request->alt(), $request->plateBlur())))->response()->setStatusCode(201);
    }

    /**
     * Approve a photo.
     *
     * The organiser, on a pending photo (409 photo_already_reviewed otherwise). It joins the gallery at the end of the approval order.
     */
    public function approve(Request $request, string $slug, string $photo, ReviewEventPhoto $action): EventPhotoResource
    {
        /** @var User $user */
        $user = $request->user();

        return new EventPhotoResource($action->approve($user, $this->moderatedPhoto($slug, $photo, $user)));
    }

    /**
     * Reject a photo.
     *
     * The organiser, on a pending photo (409 photo_already_reviewed otherwise). `reason` (optional, at most 200 characters) is shown to
     * the uploader only; the files go after 7 days.
     */
    public function reject(RejectEventPhotoRequest $request, string $slug, string $photo, ReviewEventPhoto $action): EventPhotoResource
    {
        /** @var User $user */
        $user = $request->user();

        return new EventPhotoResource($action->reject($user, $this->moderatedPhoto($slug, $photo, $user), $request->reason()));
    }

    /**
     * Delete a photo.
     *
     * The uploader (own, any status; also when they can no longer see the event) or the organiser (any). Open under a publishing
     * restriction. Answers 204.
     */
    public function destroy(Request $request, string $slug, string $photo, DeleteEventPhoto $action): Response
    {
        /** @var User $user */
        $user = $request->user();
        $event = Event::query()->with('organiser')->where('slug', mb_strtolower($slug))->first();
        $row = $event instanceof Event ? $this->photoOf($event, $photo) : null;

        if (! $row instanceof EventPhoto || ! $row->isUploadedBy($user)) {
            // Anybody but the uploader goes through the event's visibility first: 404 event_unavailable for an event they cannot see.
            $event = $this->findEvent($slug, $user);
            $row = $this->photoOf($event, $photo) ?? throw new ApiException(ErrorCode::EventPhotoUnavailable);
        }

        $row->setRelation('event', $event);
        Gate::forUser($user)->authorize('delete', $row);
        $action->handle($row);

        return response()->noContent();
    }

    private function moderatedPhoto(string $slug, string $photo, User $user): EventPhoto
    {
        $event = $this->findEvent($slug, $user);
        Gate::forUser($user)->authorize('moderatePhotos', $event);
        $row = $this->photoOf($event, $photo) ?? throw new ApiException(ErrorCode::EventPhotoUnavailable);
        $row->setRelation('event', $event);

        return $row;
    }

    private function photoOf(Event $event, string $id): ?EventPhoto
    {
        return EventPhoto::query()->where('event_id', $event->id)->whereKey(mb_strtolower($id))
            ->where('status', '!=', GalleryPhotoStatus::Removed->value)->first();
    }
}
