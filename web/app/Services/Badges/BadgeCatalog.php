<?php

namespace App\Services\Badges;

use App\Models\Badge;
use App\Models\User;
use App\Models\UserBadge;
use Carbon\CarbonInterface;

/**
 * The badge lists of the API (m5.9d contract §2, §10.2). Active badges only, in their admin order.
 */
final class BadgeCatalog
{
    /**
     * Every active badge with the member's earned_at; $unseen: only the earned ones whose unlock toast has not shown yet (newest first).
     *
     * @return list<array{badge: Badge, earned_at: CarbonInterface|null}>
     */
    public function forMember(User $member, bool $unseen = false): array
    {
        $earned = UserBadge::query()->where('user_id', $member->id)->when($unseen, fn ($query) => $query->whereNull('seen_at'))->get()->keyBy('badge_key');
        $badges = Badge::query()->where('active', true)
            ->when($unseen, fn ($query) => $query->whereKey($earned->keys()->all()))
            ->orderBy('sort')->orderBy('key')->get();

        $rows = [];

        foreach ($badges as $badge) {
            $row = $earned->get($badge->key);
            $rows[] = ['badge' => $badge, 'earned_at' => $row instanceof UserBadge ? $row->awarded_at : null];
        }

        if ($unseen) {
            usort($rows, fn (array $a, array $b): int => $b['earned_at'] <=> $a['earned_at']);
        }

        return $rows;
    }

    /**
     * Another member's earned, active badges (a hidden one shows once earned), newest first.
     *
     * @return list<array{badge: Badge, earned_at: CarbonInterface|null}>
     */
    public function earnedBy(User $member): array
    {
        return array_values(array_filter($this->forMember($member), fn (array $row): bool => $row['earned_at'] !== null));
    }
}
