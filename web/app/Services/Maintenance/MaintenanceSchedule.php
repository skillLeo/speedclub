<?php

namespace App\Services\Maintenance;

use App\Enums\MaintenanceDueState;
use App\Enums\MaintenanceType;
use App\Models\MaintenanceItem;
use Carbon\CarbonImmutable;

/**
 * When a maintenance item is due (09 §8.8), in Europe/Berlin calendar days:
 *
 * - interval types (service, oil, brake fluid, custom): last done + interval months / km; a date the member pinned wins until the next
 *   log entry;
 * - HU/AU: the month on the plakette (first day; vehicles.hu_au_due), after an inspection the month + interval (24 months); overdue only
 *   once that month is over, as the plakette is valid to its end;
 * - tyre change "O bis O": 15 October (winter tyres) and two weeks after Easter Sunday (summer tyres), the next one after the last change,
 *   never more than 30 days in the past, so an unlogged season rolls on;
 * - insurance: the Stichtag 30 November, the same way.
 */
final class MaintenanceSchedule
{
    /** km before next_due_km that count as "soon" and send the km reminder. */
    public const SOON_KM = 1000;

    /** A season or Stichtag stays shown as overdue this long before the next one takes over. */
    private const ROLL_AFTER_DAYS = 30;

    /**
     * Today's date in Europe/Berlin, as midnight UTC: every date here is a calendar day at midnight UTC, as the date columns read.
     */
    public static function today(): CarbonImmutable
    {
        return self::day(CarbonImmutable::now(config()->string('speedclub.notifications.timezone'))->toDateString());
    }

    /** A calendar day ("2027-03-01") at midnight UTC. */
    public static function day(string $date): CarbonImmutable
    {
        return CarbonImmutable::parse(substr($date, 0, 10), 'UTC')->startOfDay();
    }

    /**
     * The next due date the item should store, from its type, last time, interval and pin.
     */
    public function nextDueAt(MaintenanceItem $item, ?CarbonImmutable $today = null): ?CarbonImmutable
    {
        $today ??= self::today();
        $last = $item->last_done_at;

        return match ($item->type->schedule()) {
            'seasonal' => $this->nextOccurrence($last, $today, fn (int $year): array => [self::summerTyres($year), self::winterTyres($year)]),
            'annual' => $this->nextOccurrence($last, $today, fn (int $year): array => [self::insuranceStichtag($year)]),
            'month' => $item->due_pinned || $last === null || $item->interval_months === null
                ? ($item->next_due_at === null ? null : self::day($item->next_due_at->toDateString())->startOfMonth())
                : self::day($last->toDateString())->startOfMonth()->addMonthsNoOverflow($item->interval_months),
            default => $item->due_pinned || $last === null || $item->interval_months === null
                ? ($item->due_pinned && $item->next_due_at !== null ? self::day($item->next_due_at->toDateString()) : null)
                : self::day($last->toDateString())->addMonthsNoOverflow($item->interval_months),
        };
    }

    public function nextDueKm(MaintenanceItem $item): ?int
    {
        if ($item->type->schedule() !== 'interval' && $item->type !== MaintenanceType::HuAu) {
            return null;
        }

        if ($item->due_pinned || $item->last_done_km === null || $item->interval_km === null) {
            return $item->due_pinned ? $item->next_due_km : null;
        }

        return $item->last_done_km + $item->interval_km;
    }

    /**
     * The last day the item is not yet overdue: the due date, or the end of the HU/AU month.
     */
    public function deadline(MaintenanceItem $item): ?CarbonImmutable
    {
        $due = $item->next_due_at;

        return $due === null ? null : ($item->type === MaintenanceType::HuAu ? $due->endOfMonth()->startOfDay() : $due);
    }

    public function state(MaintenanceItem $item, ?int $odometer, ?CarbonImmutable $today = null): MaintenanceDueState
    {
        $today ??= self::today();
        $deadline = $this->deadline($item);
        $kmLeft = $this->kmLeft($item, $odometer);

        if ($deadline === null && $item->next_due_km === null) {
            return MaintenanceDueState::Unknown;
        }

        if (($deadline !== null && $today->greaterThan($deadline)) || ($kmLeft !== null && $kmLeft <= 0)) {
            return MaintenanceDueState::Overdue;
        }

        $lead = $item->leadDays()[0] ?? 0;
        $due = $item->next_due_at;

        if (($due !== null && $today->greaterThanOrEqualTo($due->subDays(max($lead, 1)))) || ($kmLeft !== null && $kmLeft <= self::SOON_KM)) {
            return MaintenanceDueState::Soon;
        }

        return MaintenanceDueState::Ok;
    }

    /**
     * Whole days from today to the due date (negative once past it), or null without a date.
     */
    public function daysLeft(MaintenanceItem $item, ?CarbonImmutable $today = null): ?int
    {
        $today ??= self::today();
        $due = $item->next_due_at;

        return $due === null ? null : (int) $today->diffInDays($due, false);
    }

    public function kmLeft(MaintenanceItem $item, ?int $odometer): ?int
    {
        return $item->next_due_km === null || $odometer === null ? null : $item->next_due_km - $odometer;
    }

    /**
     * How much of the interval has passed, 0 to 1, by date or by km (the larger), for the MNT-01 ring; null without a start and an end.
     */
    public function progress(MaintenanceItem $item, ?int $odometer, ?CarbonImmutable $today = null): ?float
    {
        $today ??= self::today();
        $parts = [];
        $last = $item->last_done_at;
        $due = $item->next_due_at;

        if ($last !== null && $due !== null && $due->greaterThan($last)) {
            $parts[] = $last->diffInDays($today, false) / $last->diffInDays($due);
        }

        if ($item->last_done_km !== null && $item->next_due_km !== null && $odometer !== null && $item->next_due_km > $item->last_done_km) {
            $parts[] = ($odometer - $item->last_done_km) / ($item->next_due_km - $item->last_done_km);
        }

        return $parts === [] ? null : round(max(0.0, min(1.0, max($parts))), 3);
    }

    /**
     * For a tyre change: which tyres go on at the next due date.
     */
    public function season(MaintenanceItem $item): ?string
    {
        if ($item->type !== MaintenanceType::TyreChange || $item->next_due_at === null) {
            return null;
        }

        return $item->next_due_at->month === 10 ? 'winter' : 'summer';
    }

    /** Easter Sunday (Gregorian, anonymous algorithm): the calendar extension is not on every host. */
    public static function easter(int $year): CarbonImmutable
    {
        $a = $year % 19;
        $b = intdiv($year, 100);
        $c = $year % 100;
        $d = intdiv($b, 4);
        $e = $b % 4;
        $f = intdiv($b + 8, 25);
        $g = intdiv($b - $f + 1, 3);
        $h = (19 * $a + $b - $d - $g + 15) % 30;
        $i = intdiv($c, 4);
        $k = $c % 4;
        $l = (32 + 2 * $e + 2 * $i - $h - $k) % 7;
        $m = intdiv($a + 11 * $h + 22 * $l, 451);
        $month = intdiv($h + $l - 7 * $m + 114, 31);
        $day = (($h + $l - 7 * $m + 114) % 31) + 1;

        return self::date($year, $month, $day);
    }

    public static function summerTyres(int $year): CarbonImmutable
    {
        return self::easter($year)->addDays(14);
    }

    public static function winterTyres(int $year): CarbonImmutable
    {
        return self::date($year, 10, 15);
    }

    public static function insuranceStichtag(int $year): CarbonImmutable
    {
        return self::date($year, 11, 30);
    }

    /**
     * The first date of the rule on or after the later of the day after the last time and ROLL_AFTER_DAYS before today.
     *
     * @param  \Closure(int): list<CarbonImmutable>  $dates
     */
    private function nextOccurrence(?CarbonImmutable $last, CarbonImmutable $today, \Closure $dates): CarbonImmutable
    {
        $from = $today->subDays(self::ROLL_AFTER_DAYS);

        if ($last !== null && self::day($last->toDateString())->addDay()->greaterThan($from)) {
            $from = self::day($last->toDateString())->addDay();
        }

        for ($year = $from->year; ; $year++) {
            foreach ($dates($year) as $date) {
                if ($date->greaterThanOrEqualTo($from)) {
                    return $date;
                }
            }
        }
    }

    private static function date(int $year, int $month, int $day): CarbonImmutable
    {
        return CarbonImmutable::create($year, $month, $day, 0, 0, 0, 'UTC') ?? throw new \LogicException('Not a date.');
    }
}
