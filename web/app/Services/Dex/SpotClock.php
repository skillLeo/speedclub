<?php

namespace App\Services\Dex;

use Carbon\CarbonInterface;

/**
 * The night rule (m5.9b contract §0): a spot between `dex.night.from` and `dex.night.to` in Europe/Berlin (display_timezone) is counted,
 * but its city is never shown for a single car.
 */
final class SpotClock
{
    public static function isNight(CarbonInterface $at): bool
    {
        $local = $at->copy()->setTimezone(config()->string('speedclub.display_timezone'))->format('H:i');
        $from = (string) config('speedclub.dex.night.from', '22:00');
        $to = (string) config('speedclub.dex.night.to', '06:00');

        return $from <= $to ? ($local >= $from && $local < $to) : ($local >= $from || $local < $to);
    }
}
