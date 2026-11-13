<?php

namespace App\Services\Events;

use App\Enums\RsvpStatus;
use App\Enums\UserStatus;
use App\Models\Event;
use App\Models\EventRsvp;
use App\Models\User;
use App\Models\Vehicle;
use App\Services\Discover\VisibleBuilds;
use App\Services\Garage\VehiclePresenter;
use App\Services\Showcase\SampleContent;
use Illuminate\Support\Collection;
use Illuminate\Support\Facades\DB;

/**
 * Loads what the event resources read, one query per kind for a whole page: organiser with avatar, cover, the RSVP counts, the
 * viewer's own answer (as the `viewerRsvp` relation) and the attendee preview of the card.
 */
class EventPresenter
{
    public const PREVIEW = 3;

    public function __construct(
        private readonly Rsvps $rsvps,
        private readonly VisibleBuilds $builds,
    ) {}

    /**
     * @param  iterable<Event>  $events
     */
    public function prepare(iterable $events, ?User $viewer): void
    {
        $list = $events instanceof Collection ? $events->all() : (is_array($events) ? $events : iterator_to_array($events));
        /** @var list<Event> $list */
        $list = array_values(array_filter($list, fn (mixed $event): bool => $event instanceof Event));

        if ($list === []) {
            return;
        }

        $collection = new \Illuminate\Database\Eloquent\Collection($list);
        $collection->loadMissing(['organiser.avatar', 'cover']);
        $ids = array_map(fn (Event $event): string => $event->id, $list);
        $counts = $this->rsvps->counts($ids);
        $mine = $viewer === null ? collect() : EventRsvp::query()->whereIn('event_id', $ids)->where('user_id', $viewer->id)->get()->keyBy('event_id');
        $this->organiserCovers($viewer, $collection);
        $previews = $this->previews($viewer, array_values(array_map(fn (Event $event): string => $event->id, array_filter($list, fn (Event $event): bool => ! SampleContent::isSample($event)))));

        foreach ($list as $event) {
            $event->rsvpCounts = $counts[$event->id] ?? ['going' => 0, 'interested' => 0, 'waitlist' => 0];
            $event->attendeePreview = $previews[$event->id] ?? [];

            if ($viewer !== null) {
                $event->setRelation('viewerRsvp', $mine->get($event->id));
            }
        }
    }

    /**
     * The cover of each organiser's main build (the car badge on the organiser chip), only a build the reader may see in a list
     * (VisibleBuilds: public, published, no block, samples only while shown); null otherwise. Two queries for a page.
     *
     * @param  \Illuminate\Database\Eloquent\Collection<int, Event>  $events
     */
    private function organiserCovers(?User $viewer, \Illuminate\Database\Eloquent\Collection $events): void
    {
        $organisers = $events->map(fn (Event $event): User => $event->organiser)->unique('id')->keyBy('id');
        $mains = $this->builds->query($viewer)->whereIn('vs.owner_id', $organisers->keys()->all())->where('v.is_main', true)
            ->pluck('vs.vehicle_id', 'vs.owner_id')->map(strval(...))->all();
        $vehicles = $this->builds->vehicles(array_values($mains));
        $presenter = app(VehiclePresenter::class);

        foreach ($events as $event) {
            $vehicle = $vehicles[$mains[$event->organiser->id] ?? ''] ?? null;
            $event->organiser->setRelation('mainVehicleCover', $vehicle instanceof Vehicle ? $presenter->cover($vehicle, false) : null);
        }
    }

    /**
     * The EventCard's avatars (09 §5 EventCard): up to PREVIEW going members per event, by the rules of EVT-04's member list (security
     * review M4.12): members only, publicly visible, findable (discoverable), no block either way with the viewer, sample members only
     * while samples are shown, never on a sample event; ordered by username, as that list, so the order says nothing about answer times.
     * One query for a page.
     *
     * @param  list<string>  $ids
     * @return array<string, list<User>>
     */
    private function previews(?User $viewer, array $ids): array
    {
        if ($viewer === null || $ids === []) {
            return [];
        }

        $ranked = DB::table('event_rsvps', 'r')
            ->join('users as u', 'u.id', '=', 'r.user_id')
            ->whereIn('r.event_id', $ids)
            ->where('r.status', RsvpStatus::Going->value)
            ->whereNull('r.removed_at')
            ->whereNull('u.deleted_at')
            ->where('u.status', UserStatus::Active->value)
            ->whereNotNull('u.email_verified_at')
            ->whereNotNull('u.username')
            ->where('u.discoverable', true)
            ->when(! $this->builds->samplesVisible(), fn ($query) => $query->where('u.is_sample', false))
            ->selectRaw('r.event_id, r.user_id, ROW_NUMBER() OVER (PARTITION BY r.event_id ORDER BY u.username) as position');
        $this->builds->withoutBlocks($ranked, $viewer, 'r.user_id');

        $rows = DB::query()->fromSub($ranked, 'ranked')->where('position', '<=', self::PREVIEW)->orderBy('event_id')->orderBy('position')->get();
        $users = User::query()->with('avatar')->whereKey($rows->pluck('user_id')->unique()->values()->all())->get()->keyBy('id');
        $previews = [];

        foreach ($rows as $row) {
            /** @var object{event_id: string, user_id: string} $row */
            $user = $users->get($row->user_id);

            if ($user instanceof User) {
                $previews[$row->event_id][] = $user;
            }
        }

        return $previews;
    }
}
