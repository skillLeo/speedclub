<?php

namespace App\Enums;

use App\Support\Enums\HasLabel;

/**
 * M5.9b STREET DEX (10 §16.2, contract §1, §6): the rarity tier of a car. Highest applicable wins: ghost > legend > rare > tuned >
 * street. Ghost is the owner's opt-in (vehicles.ghost_mode) and overrides whatever was computed; the thresholds live in
 * config/speedclub.php `dex.rarity` (App\Services\Dex\RarityRules).
 */
enum Rarity: string
{
    use HasLabel;

    case Street = 'street';
    case Tuned = 'tuned';
    case Rare = 'rare';
    case Legend = 'legend';
    case Ghost = 'ghost';

    /** Higher is rarer. */
    public function rank(): int
    {
        return match ($this) {
            self::Street => 0,
            self::Tuned => 1,
            self::Rare => 2,
            self::Legend => 3,
            self::Ghost => 4,
        };
    }
}
