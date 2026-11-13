<?php

namespace App\Http\Controllers\Api\V1\Events;

use App\Exceptions\ApiException;
use App\Http\Controllers\Controller;
use App\Models\User;
use App\Services\AppConfig\FeatureFlags;
use App\Services\Events\EventCalendar;
use App\Services\Events\EventLocation;
use App\Support\Viewer;
use Illuminate\Http\Request;
use Symfony\Component\HttpFoundation\Response;

/**
 * The calendar file (09 §8.7 "In Kalender"): `GET api/v1/events/{slug}.ics` for the reader behind the token (the exact place when they
 * may read it), and `GET /e/{slug}.ics` on the web, public or signed for one member (EventCalendar::urlFor).
 */
class EventCalendarController extends Controller
{
    use FindsEvents;

    /**
     * Download the calendar file.
     *
     * Guests too. text/calendar; the exact place only for the organiser and going members of an after_rsvp event.
     *
     * @unauthenticated
     */
    public function show(Request $request, string $slug, EventCalendar $calendar): Response
    {
        $viewer = Viewer::from($request);

        return $this->file($calendar, $slug, $viewer);
    }

    /**
     * /e/{slug}.ics on the web: the member of a valid signature, else a guest.
     */
    public function web(Request $request, string $slug, EventCalendar $calendar, FeatureFlags $flags): Response
    {
        abort_unless($flags->enabled('events'), 404);
        $member = null;

        if ($request->hasValidSignature() && is_string($request->query('member'))) {
            $member = User::query()->find($request->query('member'));
        }

        try {
            return $this->file($calendar, $slug, $member instanceof User ? $member : null);
        } catch (ApiException) {
            // A web page, not the API: the plain 404 page.
            abort(404);
        }
    }

    private function file(EventCalendar $calendar, string $slug, ?User $reader): Response
    {
        $event = $this->findEvent($slug, $reader);
        abort_unless($event->status->isPublic(), 404);

        return response($calendar->ics($event, EventLocation::exactFor($event, $reader)), 200, [
            'Content-Type' => 'text/calendar; charset=utf-8',
            'Content-Disposition' => 'attachment; filename="'.$event->slug.'.ics"',
            'Cache-Control' => 'private, no-store',
            'X-Robots-Tag' => 'noindex',
        ]);
    }
}
