<?php

namespace App\Http\Controllers\Admin\Members;

use App\Models\Badge;
use App\Models\Staff;
use App\Models\User;
use App\Models\UserBadge;

/**
 * ADM-10 Übersicht, panel "Abzeichen" (SEC-P5G-05): the badges the member earned, newest first (name in the staff member's language,
 * tier, hidden, when and how: event, nightly run or "Jetzt anwenden"), and whether this staff member may take one back
 * (`moderation.decide`, RevokeBadge). Read with members.view like the rest of the record.
 */
final class MemberBadgesPanel
{
    /**
     * @return array{earned: list<array<string, mixed>>, can_revoke: bool}
     */
    public static function for(User $member, Staff $staff): array
    {
        $rows = UserBadge::query()->where('user_id', $member->id)->orderByDesc('awarded_at')->orderBy('badge_key')->get();
        $badges = Badge::query()->whereIn('key', $rows->pluck('badge_key')->all())->get()->keyBy('key');

        return [
            'earned' => array_values($rows->map(function (UserBadge $row) use ($badges): array {
                $badge = $badges->get($row->badge_key);

                return [
                    'key' => $row->badge_key,
                    'name' => $badge instanceof Badge ? $badge->name() : $row->badge_key,
                    'tier' => $badge instanceof Badge ? $badge->tier->value : null,
                    'hidden' => $badge instanceof Badge && $badge->hidden,
                    'active' => $badge instanceof Badge && $badge->active,
                    'awarded_at' => $row->awarded_at->toIso8601String(),
                    'source' => $row->source_ref,
                ];
            })->all()),
            'can_revoke' => $staff->can('moderation.decide'),
        ];
    }
}
