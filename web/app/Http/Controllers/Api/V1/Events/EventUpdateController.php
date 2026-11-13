<?php

namespace App\Http\Controllers\Api\V1\Events;

use App\Actions\Events\PostEventUpdate;
use App\Http\Controllers\Controller;
use App\Http\Requests\Api\V1\Events\StoreEventUpdateRequest;
use App\Http\Resources\V1\EventUpdateResource;
use App\Models\User;
use Illuminate\Http\Request;
use Illuminate\Http\Resources\Json\AnonymousResourceCollection;
use Illuminate\Support\Facades\Gate;

/**
 * Organiser updates (EVT-02 "Updates", EVT-06 "Update an Teilnehmer"): written by the organiser, read by the organiser and members with
 * an answer.
 */
class EventUpdateController extends Controller
{
    use FindsEvents;

    /**
     * List organiser updates.
     *
     * The organiser and members with an answer (403 for anybody else); newest first, at most 50.
     */
    public function index(Request $request, string $slug): AnonymousResourceCollection
    {
        /** @var User $user */
        $user = $request->user();
        $event = $this->findEvent($slug, $user);
        Gate::authorize('viewUpdates', $event);

        return EventUpdateResource::collection($event->updates()->orderByDesc('created_at')->orderByDesc('id')->limit(50)->get());
    }

    /**
     * Post an update.
     *
     * Accepts an Idempotency-Key header. The organiser, while the event is open (409 event_closed); everybody with an answer is told.
     */
    public function store(StoreEventUpdateRequest $request, string $slug, PostEventUpdate $action): EventUpdateResource
    {
        /** @var User $user */
        $user = $request->user();
        $event = $this->organisedEvent($slug, $user);

        /** @status 201 */
        return new EventUpdateResource($action->handle($user, $event, (string) $request->validated('body')));
    }
}
