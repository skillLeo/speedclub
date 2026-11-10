<?php

namespace App\Services\Home;

/**
 * The Für dich score (02_PRODUCT_SPEC §3.8): rule-based and explainable, no hidden signals.
 *
 *     score = decay × completeness × quality + engagement + boost
 *     decay       = 0.5 ^ (hours since the last publish or visible change / 72)
 *     completeness= VehicleCompleteness percent / 100 (0–1)
 *     quality     = cover photo long edge ≥ 1600 px → 1.0, ≥ 1080 → 0.85, else (or none) 0.7
 *     engagement  = min(0.3, 0.1 × ln(1 + saves in 7 days) + 0.05 × ln(1 + new followers of the owner in 7 days))
 *     boost       = 0.5 for a build of speedclub.home.featured_slugs, else 0
 *
 * Rounded to 6 decimals, so the value goes through a cursor and back into SQL unchanged. Numbers in speedclub.home.ranking.
 */
final class RankScore
{
    public const DECIMALS = 6;

    public static function decay(float $hours): float
    {
        return 0.5 ** (max(0.0, $hours) / max(1, config()->integer('speedclub.home.ranking.half_life_hours')));
    }

    public static function quality(?int $longEdge): float
    {
        /** @var array<int, float|int> $steps */
        $steps = config()->array('speedclub.home.ranking.quality_steps');
        krsort($steps);

        foreach ($steps as $edge => $factor) {
            if ($longEdge !== null && $longEdge >= $edge) {
                return (float) $factor;
            }
        }

        return config()->float('speedclub.home.ranking.quality_floor');
    }

    public static function engagement(int $saves, int $newFollowers): float
    {
        $value = config()->float('speedclub.home.ranking.saves_weight') * log(1 + max(0, $saves))
            + config()->float('speedclub.home.ranking.followers_weight') * log(1 + max(0, $newFollowers));

        return min(config()->float('speedclub.home.ranking.engagement_cap'), $value);
    }

    public static function score(float $hours, int $completenessPercent, ?int $coverLongEdge, int $saves, int $newFollowers, bool $boosted): float
    {
        $completeness = max(0, min(100, $completenessPercent)) / 100;
        $score = self::decay($hours) * $completeness * self::quality($coverLongEdge)
            + self::engagement($saves, $newFollowers)
            + ($boosted ? config()->float('speedclub.home.ranking.admin_boost') : 0.0);

        return round($score, self::DECIMALS);
    }

    /**
     * The fixed text form used in cursors and bindings: "0.731200".
     */
    public static function format(float $score): string
    {
        return number_format($score, self::DECIMALS, '.', '');
    }
}
