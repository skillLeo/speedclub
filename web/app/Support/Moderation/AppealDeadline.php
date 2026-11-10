<?php

namespace App\Support\Moderation;

use Carbon\CarbonImmutable;
use DateTimeInterface;

/**
 * The end of the six-month appeal period (08_LEGAL_COMPLIANCE §4, Art. 20(1) DSA), counted like a German period of months:
 *
 * - § 187(1) BGB: the notification is an event, so its own day does not count;
 * - § 188(2) BGB: the period ends at the end of the day of the sixth month that has the number of the notification's day;
 * - § 188(3) BGB: a month without that day (31 August → February) ends on its last day.
 *
 * Days are days in Europe/Berlin, whatever the server's zone: a notification at 23:30 UTC on 31 March is 1 April in Berlin. The end is
 * 23:59:59 Berlin time of that day, summer or winter time alike. § 193 BGB (a deadline on a weekend or holiday moves to the next working
 * day) is not applied: the lawyer decides whether it applies to an internal complaint (OA-17).
 */
final class AppealDeadline
{
    public const MONTHS = 6;

    public const TIMEZONE = 'Europe/Berlin';

    public static function from(DateTimeInterface $notifiedAt): CarbonImmutable
    {
        return CarbonImmutable::instance($notifiedAt)
            ->setTimezone(self::TIMEZONE)
            ->startOfDay()
            ->addMonthsNoOverflow(self::MONTHS)
            ->endOfDay()
            ->startOfSecond();
    }

    public static function isOpen(DateTimeInterface $notifiedAt, ?DateTimeInterface $at = null): bool
    {
        // Open up to the last instant of the day: before 00:00:00 of the next day in Berlin.
        return CarbonImmutable::instance($at ?? CarbonImmutable::now())->lessThan(self::from($notifiedAt)->addSecond());
    }
}
