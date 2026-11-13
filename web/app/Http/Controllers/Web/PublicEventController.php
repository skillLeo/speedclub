<?php

namespace App\Http\Controllers\Web;

use App\Http\Controllers\Controller;
use App\Models\Event;
use App\Services\AppConfig\FeatureFlags;
use App\Services\PublicPages\EventPage;
use Illuminate\Http\Request;
use Illuminate\Support\Facades\Gate;
use Symfony\Component\HttpFoundation\Response;

/**
 * WEB-09 /e/{slug} (09 §9, M4.16): the public event page, behind the flag `events`. Read as a guest whoever asks (EventPage), so an
 * event a guest may not see (draft, in review, rejected, removed, followers only, an organiser who is not public, a sample while
 * samples are hidden), a missing one and the flag off all answer the same 404 page.
 */
class PublicEventController extends Controller
{
    public function __invoke(Request $request, string $slug, FeatureFlags $flags, EventPage $page): Response
    {
        $event = $flags->enabled('events') ? Event::query()->with(['organiser', 'cover'])->where('slug', mb_strtolower($slug))->first() : null;

        if (! $event instanceof Event || $event->starts_at === null || ! Gate::forUser(null)->allows('view', $event)) {
            return response()->view('public.state', ['state' => 'event_unavailable'], 404);
        }

        if ($event->slug !== $slug) {
            $query = $request->getQueryString();

            return redirect('/e/'.$event->slug.($query === null ? '' : '?'.$query), 301);
        }

        return response()->view('public.event', $page->data($event, $request));
    }
}
