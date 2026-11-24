<?php

namespace App\Services\Wrapped;

/**
 * "Build Spirit" (m5.9e contract §4): fixed rules, never random, thresholds in config/speedclub.php `wrapped.spirit`. Each rule looks at
 * the facts of one member's season; the first rule of `wrapped.spirit.order` that holds wins, so a tie always resolves the same way.
 *
 * - shakotan_artist: suspension and wheels are the dominant share of the counted mods.
 * - engine_purist: engine, exhaust and drivetrain are dominant and no mod is exterior (aero/body, wheels).
 * - detail_perfectionist: interior and electronics/lighting are dominant (there is no care/detailing category; lighting lives in
 *   `electronics`).
 * - daily_hero: maintenance logs, few mods, activity (logs or own updates) spread over several months.
 * - restomod_romantic: a car of model year ≤ max_year with modern upgrades (installed mods).
 * - track_day_tactician: only an attended organised event of type `track_day`; never inferred from parts.
 *
 * Mix rules need at least `min_mods` counted mods. Nothing here reads power, speed, price or cost.
 */
final class BuildSpiritRules
{
    /**
     * @param  array<string, int>  $categories  counted mods per category key
     * @param  array{car: string, year: int, mods: int}|null  $restomod  the member's classic with the most installed mods
     * @return array{key: string, params: array<string, int|string>}|null
     */
    public function decide(array $categories, int $trackDays, int $logs, int $seasonMods, int $activeMonths, ?array $restomod): ?array
    {
        /** @var array<string, mixed> $config */
        $config = config()->array('speedclub.wrapped.spirit');
        /** @var list<string> $order */
        $order = $config['order'];

        foreach ($order as $key) {
            $params = $this->rule($key, $config, $categories, $trackDays, $logs, $seasonMods, $activeMonths, $restomod);

            if ($params !== null) {
                return ['key' => $key, 'params' => $params];
            }
        }

        return null;
    }

    /**
     * @param  array<string, mixed>  $config
     * @param  array<string, int>  $categories
     * @param  array{car: string, year: int, mods: int}|null  $restomod
     * @return array<string, int|string>|null
     */
    private function rule(string $key, array $config, array $categories, int $trackDays, int $logs, int $seasonMods, int $activeMonths, ?array $restomod): ?array
    {
        /** @var array<string, list<string>> $groups */
        $groups = $config['groups'];
        /** @var list<string> $exterior */
        $exterior = $config['exterior'];
        /** @var array{max_year: int, min_mods: int} $resto */
        $resto = $config['restomod'];
        /** @var array{min_logs: int, max_mods: int, min_months: int} $daily */
        $daily = $config['daily_hero'];

        return match ($key) {
            'restomod_romantic' => $restomod !== null && $restomod['year'] <= $resto['max_year'] && $restomod['mods'] >= $resto['min_mods']
                ? ['car' => $restomod['car'], 'year' => $restomod['year'], 'mods' => $restomod['mods']]
                : null,
            'track_day_tactician' => $trackDays > 0 ? ['count' => $trackDays] : null,
            'shakotan_artist', 'detail_perfectionist' => $this->dominant($groups[$key] ?? [], $categories, $config),
            'engine_purist' => $this->sum($exterior, $categories) === 0 ? $this->dominant($groups[$key] ?? [], $categories, $config) : null,
            'daily_hero' => $logs >= $daily['min_logs'] && $seasonMods <= $daily['max_mods'] && $activeMonths >= $daily['min_months']
                ? ['logs' => $logs, 'months' => $activeMonths]
                : null,
            default => null,
        };
    }

    /**
     * @param  list<string>  $group
     * @param  array<string, int>  $categories
     * @param  array<string, mixed>  $config
     * @return array{share: int}|null
     */
    private function dominant(array $group, array $categories, array $config): ?array
    {
        $total = array_sum($categories);

        if ($group === [] || $total < (int) $config['min_mods']) {
            return null;
        }

        $share = $this->sum($group, $categories) / $total;

        return $share >= (float) $config['dominant_share'] ? ['share' => (int) round($share * 100)] : null;
    }

    /**
     * @param  list<string>  $keys
     * @param  array<string, int>  $categories
     */
    private function sum(array $keys, array $categories): int
    {
        return array_sum(array_map(fn (string $key): int => $categories[$key] ?? 0, $keys));
    }
}
