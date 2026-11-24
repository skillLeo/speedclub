<?php

namespace App\Services\Progress;

use App\Enums\XpType;
use App\Models\User;

/**
 * GET me/level (m5.9d contract §10.1): level, title, XP, the next level, progress, today's XP against the cap, the fixed rules and
 * the level ladder (every title with the XP where it starts).
 */
final class LevelReport
{
    public function __construct(
        private readonly Levels $levels,
        private readonly Xp $xp,
    ) {}

    /**
     * @return array{level: int, title: string, xp: int, next_level_xp: int|null, progress: float, today: array{earned: int, cap: int}, rules: list<array{type: string, points: int, daily_max: int|null}>, ladder: list<array{level: int, title: string, from_xp: int}>}
     */
    public function for(User $member): array
    {
        $rules = [];

        foreach (XpType::cases() as $type) {
            if ($type->points() > 0) {
                $rules[] = ['type' => $type->value, 'points' => $type->points(), 'daily_max' => $type->dailyMax()];
            }
        }

        return [
            ...$this->levels->for((int) $member->getAttribute('xp')),
            'today' => ['earned' => $this->xp->today($member), 'cap' => config()->integer('speedclub.xp.daily_cap')],
            'rules' => $rules,
            'ladder' => $this->levels->ladder(),
        ];
    }
}
