<?php

namespace App\Http\Controllers\Api\V1\Events;

use App\Http\Controllers\Controller;
use App\Http\Requests\Api\V1\Events\MyEventsRequest;
use App\Http\Resources\V1\EventCardResource;
use App\Models\User;
use App\Services\Events\EventFeed;
use App\Services\Events\EventPresenter;
use Illuminate\Http\Resources\Json\AnonymousResourceCollection;

class MyEventsController extends Controller
{
    /**
     * My events.
     *
     * EVT-05 Meine Treffen: `tab` going (with the waitlist, by start), interested, organised (every status of my own, upcoming and
     * unsent) or past (newest first).
     */
    public function __invoke(MyEventsRequest $request, EventFeed $feed, EventPresenter $presenter): AnonymousResourceCollection
    {
        /** @var User $user */
        $user = $request->user();
        $past = $request->tab() === 'past';
        $query = $feed->mine($user, $request->tab());
        $query = $past
            ? $query->orderByDesc('events.starts_at')->orderByDesc('events.id')
            : $query->orderBy('events.starts_at')->orderBy('events.id');

        $page = $query->cursorPaginate($request->pageSize())->withQueryString();
        $presenter->prepare($page->items(), $user);

        return EventCardResource::collection($page);
    }
}
