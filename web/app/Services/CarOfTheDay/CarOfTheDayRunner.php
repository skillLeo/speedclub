<?php

namespace App\Services\CarOfTheDay;

use Carbon\CarbonImmutable;
use Illuminate\Support\Facades\Cache;

/**
 * car-of-the-day:run (every five minutes 17:55–23:55 Europe/Berlin): picks today's car from 17:55 when there is none, publishes and
 * tells from 18:00, and from 18:00 freezes the candidates of tomorrow's vote while cotd_voting is on (R4-2.1). Each step is idempotent, so a late or repeated run catches up and never tells anybody twice. A cache lock keeps two
 * runs apart.
 */
final class CarOfTheDayRunner
{
    public const LOCK = 'car_of_the_day:lock';

    public function __construct(
        private readonly CarOfTheDayPicker $picker,
        private readonly CarOfTheDays $days,
        private readonly CarOfTheDayVotes $votes,
        private readonly CarOfTheDayVoting $voting,
    ) {}

    /**
     * @return array{day: string, picked: bool, published: bool, told: bool}|null null while another run holds the lock
     */
    public function run(?CarbonImmutable $now = null): ?array
    {
        $lock = Cache::lock(self::LOCK, 120);

        if (! $lock->get()) {
            return null;
        }

        try {
            $now ??= CarbonImmutable::now();
            $day = CarOfTheDayClock::today($now);
            $picked = CarOfTheDayClock::pickDue($now) && $this->picker->pick($day) !== null;
            $publish = $picked && CarOfTheDayClock::publishDue($now);
            $told = $publish && $this->days->publish($day);

            if (CarOfTheDayClock::publishDue($now) && $this->votes->enabled()) {
                $this->voting->prepare(CarOfTheDayVoting::roundDay($now), $now);
            }

            return ['day' => $day, 'picked' => $picked, 'published' => $publish, 'told' => $told];
        } finally {
            $lock->release();
        }
    }
}
