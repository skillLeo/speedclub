<?php

namespace App\Services\Businesses;

use Carbon\CarbonImmutable;

/**
 * Opening hours of BIZ-01/02: {"mon": [["09:00", "18:00"]], ...}, up to two ranges a day (a lunch break), a day without ranges closed.
 * BIZ-01 highlights today in Europe/Berlin.
 */
final class BusinessHours
{
    public const DAYS = ['mon', 'tue', 'wed', 'thu', 'fri', 'sat', 'sun'];

    private const TIME = '/\A([01]\d|2[0-3]):[0-5]\d\z/';

    /**
     * Null when $value is not valid opening hours; [] for none given.
     *
     * @return array<string, list<array{0: string, 1: string}>>|null
     */
    public static function normalise(mixed $value): ?array
    {
        if ($value === null) {
            return [];
        }

        if (! is_array($value) || array_diff(array_keys($value), self::DAYS) !== []) {
            return null;
        }

        $hours = [];

        foreach (self::DAYS as $day) {
            $ranges = $value[$day] ?? [];

            if (! is_array($ranges) || count($ranges) > 2) {
                return null;
            }

            $clean = [];
            $last = '';

            foreach (array_values($ranges) as $range) {
                if (! is_array($range) || count($range) !== 2 || ! is_string($range[0] ?? null) || ! is_string($range[1] ?? null)
                    || preg_match(self::TIME, $range[0]) !== 1 || preg_match(self::TIME, $range[1]) !== 1 || $range[0] >= $range[1] || $range[0] < $last) {
                    return null;
                }

                $clean[] = [$range[0], $range[1]];
                $last = $range[1];
            }

            if ($clean !== []) {
                $hours[$day] = $clean;
            }
        }

        return $hours;
    }

    /**
     * Every day in order with its ranges and whether it is today.
     *
     * @param  array<string, mixed>|null  $hours
     * @return list<array{day: string, ranges: list<array{opens: string, closes: string}>, today: bool}>
     */
    public static function week(?array $hours, ?CarbonImmutable $now = null): array
    {
        $now ??= CarbonImmutable::now(config()->string('speedclub.display_timezone'));
        $today = self::DAYS[$now->dayOfWeekIso - 1];
        $week = [];

        foreach (self::DAYS as $day) {
            $ranges = is_array($hours[$day] ?? null) ? $hours[$day] : [];
            $week[] = [
                'day' => $day,
                'ranges' => array_values(array_map(fn (array $range): array => ['opens' => (string) $range[0], 'closes' => (string) $range[1]], array_filter($ranges, fn (mixed $range): bool => is_array($range) && count($range) === 2))),
                'today' => $day === $today,
            ];
        }

        return $week;
    }
}
