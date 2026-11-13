<?php

namespace App\Services\Events;

use App\Models\Event;
use App\Models\User;
use App\Services\AppConfig\FeatureFlags;

/**
 * The event strips of HOME-01 and DISC-01 (M4.8, 09 §7.3, §7.5): "Treffen in deiner Nähe" around a point the device gave for this request
 * (never stored, 09 §8.7) and "Treffen am Wochenende". Through EventFeed::listed, so visibility, blocks, moderation and hidden samples
 * apply as on EVT-01; prepared for EventCardResource like the list (one query per strip). Empty while `events` is off.
 */
final class NearbyEvents
{
    private const NEARBY = 2;

    private const WEEKEND = 6;

    public function __construct(
        private readonly EventFeed $feed,
        private readonly EventPresenter $presenter,
        private readonly FeatureFlags $flags,
    ) {}

    /**
     * @param  array{0: float, 1: float}|null  $point
     * @return list<Event>
     */
    public function near(?User $viewer, ?array $point): array
    {
        if ($point === null || ! $this->flags->enabled('events')) {
            return [];
        }

        $query = $this->feed->filter($this->feed->listed($viewer), ['when' => 'upcoming', 'lat' => $point[0], 'lng' => $point[1]]);

        return $this->prepared($query->orderBy('events.starts_at')->orderBy('events.id')->limit(self::NEARBY)->get()->values()->all(), $viewer);
    }

    /**
     * @return list<Event>
     */
    public function weekend(?User $viewer): array
    {
        if (! $this->flags->enabled('events')) {
            return [];
        }

        $query = $this->feed->filter($this->feed->listed($viewer), ['when' => 'weekend']);

        return $this->prepared($query->orderBy('events.starts_at')->orderBy('events.id')->limit(self::WEEKEND)->get()->values()->all(), $viewer);
    }

    /**
     * @param  array<int, Event>  $events
     * @return list<Event>
     */
    private function prepared(array $events, ?User $viewer): array
    {
        $this->presenter->prepare($events, $viewer);

        return array_values($events);
    }
}
