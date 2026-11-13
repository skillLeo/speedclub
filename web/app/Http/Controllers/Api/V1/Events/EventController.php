<?php

namespace App\Http\Controllers\Api\V1\Events;

use App\Actions\Events\CancelEvent;
use App\Actions\Events\CreateEvent;
use App\Actions\Events\DeleteEvent;
use App\Actions\Events\RemoveEventCover;
use App\Actions\Events\SubmitEvent;
use App\Actions\Events\UpdateEvent;
use App\Actions\Events\UploadEventCover;
use App\Enums\ErrorCode;
use App\Exceptions\ApiException;
use App\Http\Controllers\Controller;
use App\Http\Requests\Api\V1\Events\EventListRequest;
use App\Http\Requests\Api\V1\Events\ReasonRequest;
use App\Http\Requests\Api\V1\Events\StoreEventCoverRequest;
use App\Http\Requests\Api\V1\Events\StoreEventRequest;
use App\Http\Requests\Api\V1\Events\UpdateEventRequest;
use App\Http\Resources\V1\EventCardResource;
use App\Http\Resources\V1\EventPinResource;
use App\Http\Resources\V1\EventResource;
use App\Http\Resources\V1\MediaResource;
use App\Models\Event;
use App\Models\User;
use App\Policies\EventPolicy;
use App\Services\Events\EventFeed;
use App\Services\Events\EventPresenter;
use App\Support\Viewer;
use Illuminate\Http\Request;
use Illuminate\Http\Resources\Json\AnonymousResourceCollection;
use Illuminate\Http\Response;
use Illuminate\Http\UploadedFile;
use Illuminate\Support\Facades\Gate;

/**
 * Events and meets (09 §8.7, EVT-01…03, EVT-06, WEB-09 data; flags `events` and `events.create`). Reads take guests; writes are the
 * organiser's. An event the reader may not see is 404 event_unavailable, whatever the reason.
 */
class EventController extends Controller
{
    use FindsEvents;

    /**
     * List upcoming events.
     *
     * Guests too. EVT-01 Liste, Entdecken "Treffen am Wochenende" (`when=weekend`) and Home (`when=upcoming&per_page=3`): published,
     * not ended, public (and followers-only events of members the reader follows), by start. `lat`/`lng` (+ `radius_km`) filter by
     * distance to the area point and fill `distance_km`; `near=home` uses the member's SET-11 region instead; `bbox` limits to the map's
     * view; `q` searches title and city. Never the exact place of an after_rsvp event.
     *
     * @unauthenticated
     */
    public function index(EventListRequest $request, EventFeed $feed, EventPresenter $presenter): AnonymousResourceCollection
    {
        $viewer = Viewer::from($request);
        $page = $feed->filter($feed->listed($viewer), $request->filters())
            ->orderBy('events.starts_at')
            ->orderBy('events.id')
            ->cursorPaginate($request->pageSize())
            ->withQueryString();

        $presenter->prepare($page->items(), $viewer);

        return EventCardResource::collection($page);
    }

    /**
     * Map pins.
     *
     * Guests too. EVT-01 Karte: the same events and filters as the list, at most 300, as area points (never the exact place); the app
     * clusters them.
     *
     * @unauthenticated
     */
    public function pins(EventListRequest $request, EventFeed $feed): AnonymousResourceCollection
    {
        $events = $feed->filter($feed->listed(Viewer::from($request)), $request->filters())
            ->with('organiser')
            ->orderBy('events.starts_at')
            ->orderBy('events.id')
            ->limit(config()->integer('speedclub.events.pins_max'))
            ->get();

        return EventPinResource::collection($events);
    }

    /**
     * Show an event.
     *
     * Guests too (the data of WEB-09 /e/{slug}). The exact place only for the organiser and going members of an after_rsvp event;
     * everybody else reads `location.exact` false with the city and the area point. A draft, pending or rejected event is the
     * organiser's alone; for everybody else, as for a missing one: 404 event_unavailable.
     *
     * @unauthenticated
     */
    public function show(Request $request, string $slug, EventPresenter $presenter): EventResource
    {
        $viewer = Viewer::from($request);
        $event = $this->findEvent($slug, $viewer);
        $presenter->prepare([$event], $viewer);

        return new EventResource($event);
    }

    /**
     * Create an event.
     *
     * Accepts an Idempotency-Key header. A draft with `accept_rules` true (the rules for meets); `submit` true sends it on at once (see
     * submit). Needs a verified e-mail (403 email_not_verified) and an account at least 14 days old (403 organiser_not_eligible with
     * `eligible_at`). At most 20 drafts, pending and upcoming events (409 limit_reached). A blocked term: 422 content_blocked.
     */
    public function store(StoreEventRequest $request, CreateEvent $action, EventPresenter $presenter): EventResource
    {
        /** @var User $user */
        $user = $request->user();

        if ($user->isActive() && $user->hasVerifiedEmail() && EventPolicy::eligibleAt($user)->isFuture()) {
            throw new ApiException(ErrorCode::OrganiserNotEligible, data: ['eligible_at' => EventPolicy::eligibleAt($user)->toIso8601String()]);
        }

        Gate::authorize('create', Event::class);

        $event = $action->handle($user, $request->details(), $request->boolean('submit'));
        $presenter->prepare([$event], $user);

        /** @status 201 */
        return new EventResource($event);
    }

    /**
     * Change an event.
     *
     * The organiser, while the event is not over or cancelled (409 event_closed). Changing the time or the place of a published event
     * tells everybody with an answer. `location_visibility` is fixed once sent (422).
     */
    public function update(UpdateEventRequest $request, string $slug, UpdateEvent $action, EventPresenter $presenter): EventResource
    {
        /** @var User $user */
        $user = $request->user();
        $event = $action->handle($this->organisedEvent($slug, $user), $request->details());
        $presenter->prepare([$event], $user);

        return new EventResource($event);
    }

    /**
     * Send an event.
     *
     * "Zur Prüfung senden" / "Veröffentlichen": a draft or rejected event becomes pending_review (the organiser's first two events and
     * every after_rsvp event, ADM-53) or published. Missing time, place or the legal_only rule: 422 naming the fields.
     */
    public function submit(Request $request, string $slug, SubmitEvent $action, EventPresenter $presenter): EventResource
    {
        /** @var User $user */
        $user = $request->user();
        $event = $action->handle($user, $this->organisedEvent($slug, $user));
        $presenter->prepare([$event], $user);

        return new EventResource($event);
    }

    /**
     * Cancel an event.
     *
     * EVT-06, with a reason everybody with an answer reads; they are told. A published event that has not ended, or one in review.
     */
    public function cancel(ReasonRequest $request, string $slug, CancelEvent $action, EventPresenter $presenter): EventResource
    {
        /** @var User $user */
        $user = $request->user();
        $event = $action->handle($this->organisedEvent($slug, $user), (string) $request->validated('reason'));
        $presenter->prepare([$event], $user);

        return new EventResource($event);
    }

    /**
     * Delete an event.
     *
     * A draft, pending, rejected, cancelled or past event, with its cover, answers and updates. An upcoming published event with
     * answers is cancelled first (409 conflict). Answers 204.
     */
    public function destroy(Request $request, string $slug, DeleteEvent $action): Response
    {
        /** @var User $user */
        $user = $request->user();
        $action->handle($this->organisedEvent($slug, $user, 'delete'));

        return response()->noContent();
    }

    /**
     * Upload the cover.
     *
     * Accepts an Idempotency-Key header. Re-encoded without metadata, WebP variants; replaces an earlier cover.
     */
    public function cover(StoreEventCoverRequest $request, string $slug, UploadEventCover $action): MediaResource
    {
        /** @var User $user */
        $user = $request->user();
        $event = $this->organisedEvent($slug, $user);
        $file = $request->file('file');
        abort_unless($file instanceof UploadedFile, 422);

        /** @var array{alt?: string|null, focal_x?: float|null, focal_y?: float|null} $attributes */
        $attributes = array_intersect_key($request->validated(), array_flip(['alt', 'focal_x', 'focal_y']));

        /** @status 201 */
        return new MediaResource($action->handle($user, $event, $file, $attributes));
    }

    /**
     * Remove the cover.
     *
     * The organiser, while the event is open and not in review (409 event_in_review, event_closed). The photo is deleted. Answers the
     * event, also when it had no cover.
     */
    public function removeCover(Request $request, string $slug, RemoveEventCover $action, EventPresenter $presenter): EventResource
    {
        /** @var User $user */
        $user = $request->user();
        $event = $action->handle($this->organisedEvent($slug, $user));
        $presenter->prepare([$event], $user);

        return new EventResource($event);
    }
}
