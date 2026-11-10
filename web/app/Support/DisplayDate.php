<?php

namespace App\Support;

use Carbon\CarbonImmutable;
use DateTimeInterface;

/**
 * A moment inside a translated message. Stored and computed in UTC, shown in the members' time zone. With the time of day,
 * because a date alone would name a day on which the member is still refused.
 */
final class DisplayDate
{
    public static function format(DateTimeInterface $moment): string
    {
        return CarbonImmutable::instance($moment)
            ->setTimezone(config()->string('speedclub.display_timezone'))
            ->format((string) __('errors.date_format'));
    }
}
