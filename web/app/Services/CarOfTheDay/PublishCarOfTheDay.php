<?php

namespace App\Services\CarOfTheDay;

use Illuminate\Contracts\Queue\ShouldBeUniqueUntilProcessing;
use Illuminate\Contracts\Queue\ShouldQueue;
use Illuminate\Foundation\Queue\Queueable;

/**
 * CR-P5G-04: publishes and tells a day that staff changed after it was live (OverrideCarOfTheDay, dispatched after the commit), so the
 * replacement is announced at once and not only by car-of-the-day:run, which never returns to the day Home shows before 18:00. Each
 * run stays within `car_of_the_day.seconds` (CarOfTheDays::publish); an unfinished fan-out queues the next run, which resumes at the
 * cursor. Idempotent: notified_at and the grouped rows keep anybody from being told twice.
 */
final class PublishCarOfTheDay implements ShouldBeUniqueUntilProcessing, ShouldQueue
{
    use Queueable;

    public int $tries = 3;

    public int $timeout = 50;

    /** Ids only (GarageSecurityAuditTest "queued jobs"): the Berlin date is the Car of the Day row's unique key. */
    public function __construct(public readonly string $dayId) {}

    public function uniqueId(): string
    {
        return 'car_of_the_day:publish:'.$this->dayId;
    }

    public function handle(CarOfTheDays $days): void
    {
        if (! $days->publish($this->dayId)) {
            self::dispatch($this->dayId);
        }
    }
}
