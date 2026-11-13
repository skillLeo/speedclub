<?php

namespace App\Services\Events;

use App\Enums\EventStatus;
use App\Enums\EventType;
use App\Enums\EventVisibility;
use App\Enums\RsvpStatus;
use App\Enums\UserStatus;
use App\Models\Event;
use App\Models\User;
use App\Services\Discover\VisibleBuilds;
use App\Services\Search\SearchTerms;
use Carbon\CarbonImmutable;
use Illuminate\Database\Eloquent\Builder;
use Illuminate\Database\Query\Builder as QueryBuilder;

/**
 * The lists of EVT-01 (Liste · Karte), Entdecken "Treffen am Wochenende", Home and EVT-05 (09 §7.10, §8.7). Listed are only published
 * events that have not ended, public ones and the followers-only events of members the viewer follows (unlisted never), of an organiser
 * the viewer may see (active, verified, no block either way, samples only while shown, ADR-412). Distances and map pins use the area
 * point, so a list never narrows an after_rsvp place down. Order: start, then id.
 */
class EventFeed
{
    public function __construct(private readonly VisibleBuilds $builds) {}

    /**
     * @return Builder<Event>
     */
    public function listed(?User $viewer): Builder
    {
        return $this->visibleTo(Event::query()->where('events.ends_at', '>=', now()), $viewer);
    }

    /**
     * PROF-01/02 "Treffen": the published events $member organises that $viewer may see in a list, upcoming or past, by the rules of
     * listed() (public, followers-only for followers, visible organiser, samples only while shown).
     *
     * @return Builder<Event>
     */
    public function organisedBy(?User $viewer, User $member, bool $past): Builder
    {
        $query = Event::query()->where('events.organiser_id', $member->id)
            ->when($past, fn (Builder $over) => $over->where('events.ends_at', '<', now()), fn (Builder $coming) => $coming->where('events.ends_at', '>=', now()));

        return $this->visibleTo($query, $viewer);
    }

    /**
     * Published, not removed, public or followers-only for followers, of an organiser the viewer may see.
     *
     * @param  Builder<Event>  $query
     * @return Builder<Event>
     */
    private function visibleTo(Builder $query, ?User $viewer): Builder
    {
        $query
            ->where('events.status', EventStatus::Published->value)
            ->whereNull('events.removed_at')
            ->where(fn (Builder $visibility) => $visibility->where('events.visibility', EventVisibility::Public->value)
                ->when($viewer !== null, fn (Builder $followers) => $followers->orWhere(fn (Builder $q) => $q->where('events.visibility', EventVisibility::Followers->value)
                    ->whereExists(fn (QueryBuilder $follow) => $follow->selectRaw('1')->from('follows', 'f')->where('f.follower_id', $viewer?->id)->whereColumn('f.followee_id', 'events.organiser_id')))));

        return $this->visibleOrganisers($query, $viewer);
    }

    /**
     * The filters of EVT-01: when (today · weekend · month · upcoming), type, near (with radius) and bbox (the map's view).
     *
     * @param  Builder<Event>  $query
     * @param  array{when?: string|null, type?: string|null, lat?: float|null, lng?: float|null, radius_km?: int|null, bbox?: array{0: float, 1: float, 2: float, 3: float}|null, q?: string|null}  $filters
     * @return Builder<Event>
     */
    public function filter(Builder $query, array $filters): Builder
    {
        $zone = config()->string('speedclub.notifications.timezone');
        $local = CarbonImmutable::now($zone);

        [$from, $to] = match ($filters['when'] ?? 'upcoming') {
            'today' => [$local->startOfDay(), $local->endOfDay()],
            // The coming weekend: Saturday and Sunday of this week (today when it is the weekend).
            'weekend' => [$local->isWeekend() ? $local->startOfDay() : $local->next(CarbonImmutable::SATURDAY)->startOfDay(), ($local->isSunday() ? $local : $local->next(CarbonImmutable::SUNDAY))->endOfDay()],
            'month' => [$local->startOfDay(), $local->endOfMonth()],
            default => [null, null],
        };

        if ($from !== null && $to !== null) {
            // Overlapping the window: a fair from Friday to Sunday is a weekend event.
            $query->where('events.starts_at', '<=', $to->utc())->where('events.ends_at', '>=', $from->utc());
        }

        $type = EventType::tryFrom((string) ($filters['type'] ?? ''));

        if ($type !== null) {
            $query->where('events.type', $type->value);
        }

        if (isset($filters['q'])) {
            $this->search($query, $filters['q']);
        }

        if (isset($filters['bbox'])) {
            [$minLng, $minLat, $maxLng, $maxLat] = $filters['bbox'];
            $query->whereBetween('events.area_lat', [$minLat, $maxLat])->whereBetween('events.area_lng', [$minLng, $maxLng]);
        }

        if (isset($filters['lat'], $filters['lng'])) {
            $this->near($query, $filters['lat'], $filters['lng'], (int) ($filters['radius_km'] ?? config()->integer('speedclub.events.near_default_km')));
        }

        return $query;
    }

    /**
     * EVT-01 search (`q`): every word (at most five) is found in the title or the city. Never in the venue or the street, which an
     * after_rsvp event keeps from the list.
     *
     * @param  Builder<Event>  $query
     * @return Builder<Event>
     */
    public function search(Builder $query, string $text): Builder
    {
        foreach (array_slice(SearchTerms::nameWords($text), 0, 5) as $word) {
            $like = '%'.SearchTerms::escapeLike($word).'%';
            $query->where(fn (Builder $match) => $match->whereRaw("events.title LIKE ? ESCAPE '!'", [$like])->orWhereRaw("events.city LIKE ? ESCAPE '!'", [$like]));
        }

        return $query;
    }

    /**
     * Within $radiusKm of a point (the area point of each event), with distance_km selected. A bounding box first, so the index on the
     * area columns narrows the rows before the haversine.
     *
     * @param  Builder<Event>  $query
     * @return Builder<Event>
     */
    public function near(Builder $query, float $lat, float $lng, int $radiusKm): Builder
    {
        $dLat = $radiusKm / 111.0;
        $dLng = $radiusKm / max(1.0, 111.0 * cos(deg2rad($lat)));
        $haversine = '6371 * 2 * ASIN(SQRT(POWER(SIN(RADIANS(events.area_lat - ?) / 2), 2) + COS(RADIANS(?)) * COS(RADIANS(events.area_lat)) * POWER(SIN(RADIANS(events.area_lng - ?) / 2), 2)))';

        if ($query->getQuery()->columns === null) {
            $query->select('events.*');
        }

        return $query
            ->whereBetween('events.area_lat', [$lat - $dLat, $lat + $dLat])
            ->whereBetween('events.area_lng', [$lng - $dLng, $lng + $dLng])
            ->whereRaw("$haversine <= ?", [$lat, $lat, $lng, $radiusKm])
            ->selectRaw("ROUND($haversine) as distance_km", [$lat, $lat, $lng]);
    }

    /**
     * EVT-05 Meine Treffen: going (with the waitlist), interested, organised (every status) and past.
     *
     * @return Builder<Event>
     */
    public function mine(User $user, string $tab): Builder
    {
        if ($tab === 'organised') {
            return Event::query()->where('events.organiser_id', $user->id)->whereNull('events.removed_at')
                ->where(fn (Builder $q) => $q->whereNull('events.ends_at')->orWhere('events.ends_at', '>=', now())->orWhereIn('events.status', [EventStatus::Draft->value, EventStatus::PendingReview->value]));
        }

        $answered = fn (array $statuses): \Closure => fn (QueryBuilder $rsvp) => $rsvp->selectRaw('1')->from('event_rsvps', 'r')
            ->whereColumn('r.event_id', 'events.id')->where('r.user_id', $user->id)->whereNull('r.removed_at')->whereIn('r.status', $statuses);

        if ($tab === 'past') {
            $query = Event::query()->whereIn('events.status', [EventStatus::Published->value, EventStatus::Cancelled->value])->whereNull('events.removed_at')
                ->where('events.ends_at', '<', now())
                ->where(fn (Builder $q) => $q->where('events.organiser_id', $user->id)
                    ->orWhereExists($answered([RsvpStatus::Going->value, RsvpStatus::Interested->value, RsvpStatus::Waitlist->value])));

            return $this->visibleOrganisers($query, $user, $user);
        }

        $statuses = $tab === 'interested' ? [RsvpStatus::Interested->value] : [RsvpStatus::Going->value, RsvpStatus::Waitlist->value];
        $query = Event::query()->whereIn('events.status', [EventStatus::Published->value, EventStatus::Cancelled->value])->whereNull('events.removed_at')
            ->where('events.ends_at', '>=', now())
            ->whereExists($answered($statuses));

        return $this->visibleOrganisers($query, $user);
    }

    /**
     * @param  Builder<Event>  $query
     * @return Builder<Event>
     */
    private function visibleOrganisers(Builder $query, ?User $viewer, ?User $alwaysOwn = null): Builder
    {
        $samplesVisible = $this->builds->samplesVisible();

        $query->where(fn (Builder $own) => $own
            ->when($alwaysOwn !== null, fn (Builder $q) => $q->where('events.organiser_id', $alwaysOwn?->id))
            ->orWhereExists(fn (QueryBuilder $organiser) => $organiser->selectRaw('1')->from('users', 'ou')
                ->whereColumn('ou.id', 'events.organiser_id')
                ->whereNull('ou.deleted_at')
                ->where('ou.status', UserStatus::Active->value)
                ->whereNotNull('ou.email_verified_at')
                ->when(! $samplesVisible, fn (QueryBuilder $q) => $q->where('ou.is_sample', false))));

        if (! $samplesVisible) {
            $query->where(fn (Builder $q) => $q->where('events.is_sample', false)
                ->when($alwaysOwn !== null, fn (Builder $own) => $own->orWhere('events.organiser_id', $alwaysOwn?->id)));
        }

        $this->builds->withoutBlocks($query->getQuery(), $viewer, 'events.organiser_id');

        return $query;
    }
}
