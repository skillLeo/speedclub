<?php

namespace App\Services\Garage;

use App\Models\Vehicle;
use Carbon\CarbonImmutable;

/**
 * M5.7 (10 §6.2, m5.7-contract §4.1): the owner's optional milestone goal "Ziel: Saison 2027" (vehicles.build_goal_season). Shown with
 * the Build-Fortschritt to everybody who sees the page — the owner's own statement, no social signal. No push, countdown or reminder about
 * it, ever. `passed` once the season's year is over (the app hides a passed goal from visitors).
 */
final class BuildGoal
{
    /** How many years ahead a goal may lie. */
    public const MAX_YEARS_AHEAD = 10;

    /**
     * @return array{season: int, label: string, passed: bool}|null
     */
    public static function present(Vehicle $vehicle): ?array
    {
        $season = $vehicle->getAttribute('build_goal_season');

        if (! is_int($season)) {
            return null;
        }

        return [
            'season' => $season,
            'label' => (string) __('garage.build_goal', ['season' => $season]),
            'passed' => $season < self::currentYear(),
        ];
    }

    public static function currentYear(): int
    {
        return CarbonImmutable::now(config()->string('speedclub.display_timezone'))->year;
    }
}
