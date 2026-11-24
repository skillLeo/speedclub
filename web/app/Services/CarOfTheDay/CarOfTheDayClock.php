<?php

namespace App\Services\CarOfTheDay;

use Carbon\CarbonImmutable;

/**
 * Europe/Berlin times of the Car of the Day (m5.9d contract §3): the pick at 17:55, the publication at 18:00, and which day's pick Home
 * shows (from 18:00 to the next day's 18:00, ADR-510).
 */
final class CarOfTheDayClock
{
    public static function now(): CarbonImmutable
    {
        return CarbonImmutable::now(config()->string('speedclub.car_of_the_day.timezone'));
    }

    /** The day whose pick is on Home at $now: today from publish_at, before that yesterday. */
    public static function shownDay(?CarbonImmutable $now = null): string
    {
        $now = ($now ?? self::now())->setTimezone(config()->string('speedclub.car_of_the_day.timezone'));

        return ($now->format('H:i') >= config()->string('speedclub.car_of_the_day.publish_at') ? $now : $now->subDay())->toDateString();
    }

    public static function pickDue(CarbonImmutable $now): bool
    {
        return self::local($now)->format('H:i') >= config()->string('speedclub.car_of_the_day.pick_at');
    }

    public static function publishDue(CarbonImmutable $now): bool
    {
        return self::local($now)->format('H:i') >= config()->string('speedclub.car_of_the_day.publish_at');
    }

    public static function today(CarbonImmutable $now): string
    {
        return self::local($now)->toDateString();
    }

    private static function local(CarbonImmutable $now): CarbonImmutable
    {
        return $now->setTimezone(config()->string('speedclub.car_of_the_day.timezone'));
    }
}
