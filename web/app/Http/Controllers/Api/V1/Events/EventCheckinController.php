<?php

namespace App\Http\Controllers\Api\V1\Events;

use App\Actions\Events\Checkin\CheckInToEvent;
use App\Actions\Events\Checkin\UpdateCheckin;
use App\Enums\ErrorCode;
use App\Exceptions\ApiException;
use App\Http\Controllers\Controller;
use App\Http\Requests\Api\V1\Events\StoreCheckinRequest;
use App\Http\Requests\Api\V1\Events\UpdateCheckinRequest;
use App\Http\Resources\V1\CheckinCodeResource;
use App\Http\Resources\V1\CheckinResource;
use App\Models\Event;
use App\Models\EventCheckin;
use App\Models\User;
use App\Services\Events\EventCheckins;
use App\Services\Qr\QrRenderer;
use Illuminate\Http\JsonResponse;
use Illuminate\Http\Request;
use Illuminate\Http\Response;
use Illuminate\Support\Facades\Gate;

/**
 * M5.6 check-in at the event (10 §4, m5.6-contract §5; flags `events` + `events.checkin`). The organiser's phone shows a rotating code
 * as a QR; a member in front of them scans or types it. No location is read or stored, and a check-in reaches a profile only after the
 * event has ended.
 */
class EventCheckinController extends Controller
{
    use FindsEvents;

    /**
     * Show the check-in code.
     *
     * The organiser, while the window is open (60 min before the start to 120 min after the end; 409 checkin_closed otherwise). The
     * code rotates every 5 minutes (the one before is accepted 60 s longer); ask again at `refresh_at`. `svg` is the QR of `url`.
     */
    public function code(Request $request, string $slug, EventCheckins $checkins, QrRenderer $qr): JsonResponse
    {
        /** @var User $user */
        $user = $request->user();
        $event = $this->findEvent($slug, $user);
        Gate::forUser($user)->authorize('showCheckinCode', $event);
        $checkins->assertOpen($event);

        $code = $checkins->currentCode($event);
        $url = $checkins->url($event, $code->code);

        // 200 also when this read issued a new code (a JSON resource of a model created in the request would answer 201).
        return (new CheckinCodeResource($code, $url, $qr->svg($url), EventCheckin::query()->where('event_id', $event->id)->count()))
            ->response()->setStatusCode(200);
    }

    /**
     * Check in.
     *
     * Accepts an Idempotency-Key header. `code` from the organiser's screen (case and spaces do not matter), `profile_visible` (default
     * true). 201 with the check-in; 200 with the same body when already checked in. The RSVP stays as it is. Wrong or expired code: 422
     * checkin_code_invalid (`errors.code`); after 5 wrong codes for this event in an hour 429 with Retry-After; outside the window 409
     * checkin_closed; the organiser's own event 403 checkin_own_event.
     */
    public function store(StoreCheckinRequest $request, string $slug, CheckInToEvent $action): JsonResponse
    {
        /** @var User $user */
        $user = $request->user();
        $event = $this->findEvent($slug, $user);
        Gate::forUser($user)->authorize('checkIn', $event);

        [$checkin, $created] = $action->handle($user, $event, $request->code(), $request->profileVisible());
        $checkin->setRelation('event', $event);

        /** @status 201 */
        return (new CheckinResource($checkin))->response()->setStatusCode($created ? 201 : 200);
    }

    /**
     * Change the check-in.
     *
     * "Auf meinem Profil zeigen": the member who checked in.
     */
    public function update(UpdateCheckinRequest $request, string $slug, UpdateCheckin $action): CheckinResource
    {
        /** @var User $user */
        $user = $request->user();
        $checkin = $this->own($slug, $user, 'update');

        return new CheckinResource($action->visibility($checkin, $request->boolean('profile_visible')));
    }

    /**
     * Remove the check-in.
     *
     * "War dabei entfernen": the member who checked in, at any time. Answers 204.
     */
    public function destroy(Request $request, string $slug, UpdateCheckin $action): Response
    {
        /** @var User $user */
        $user = $request->user();
        $action->remove($this->own($slug, $user, 'delete'));

        return response()->noContent();
    }

    /**
     * The member's own check-in of the event: found also when they can no longer see the event (it is their data); 404 otherwise.
     */
    private function own(string $slug, User $user, string $ability): EventCheckin
    {
        $event = Event::query()->where('slug', mb_strtolower($slug))->first() ?? throw new ApiException(ErrorCode::EventUnavailable);
        $checkin = EventCheckin::query()->where('event_id', $event->id)->where('user_id', $user->id)->first()
            ?? throw new ApiException(ErrorCode::EventUnavailable);

        Gate::forUser($user)->authorize($ability, $checkin);
        $checkin->setRelation('event', $event);

        return $checkin;
    }
}
