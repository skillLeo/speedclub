<?php

namespace App\Http\Controllers\Api\V1\Events;

use App\Http\Controllers\Controller;
use App\Http\Requests\Api\V1\Events\CheckinListRequest;
use App\Http\Resources\V1\EventCheckinCardResource;
use App\Models\EventCheckin;
use App\Models\User;
use App\Services\Events\EventPresenter;
use Illuminate\Http\Resources\Json\AnonymousResourceCollection;
use Illuminate\Support\Collection;

class MyCheckinsController extends Controller
{
    /**
     * My check-ins.
     *
     * PROF-01 "War dabei", the member's own: every event they checked in to (also hidden from the profile, also while it is running),
     * newest check-in first, as EventCards with `checked_in_at` and `profile_visible`. Events staff removed are left out.
     */
    public function __invoke(CheckinListRequest $request, EventPresenter $presenter): AnonymousResourceCollection
    {
        /** @var User $user */
        $user = $request->user();
        $page = EventCheckin::query()->where('event_checkins.user_id', $user->id)
            ->whereHas('event', fn ($event) => $event->whereNull('events.removed_at'))
            ->with('event.organiser')
            ->orderByDesc('event_checkins.checked_in_at')->orderByDesc('event_checkins.id')
            ->cursorPaginate($request->pageSize())->withQueryString();

        $presenter->prepare(Collection::make($page->items())->map(fn (EventCheckin $checkin) => $checkin->event), $user);

        return EventCheckinCardResource::collection($page);
    }
}
