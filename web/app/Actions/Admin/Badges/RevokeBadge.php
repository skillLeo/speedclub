<?php

namespace App\Actions\Admin\Badges;

use App\Enums\GiftEvent;
use App\Enums\NotificationType;
use App\Models\Badge;
use App\Models\Notification;
use App\Models\Staff;
use App\Models\User;
use App\Models\UserBadge;
use App\Services\Admin\Members\StaffAtoms;
use App\Services\Audit\Audit;
use Illuminate\Support\Facades\DB;
use Illuminate\Validation\ValidationException;

/**
 * SEC-P5G-05 "Badge entziehen" (ADM-10, abuse handling like "Spot entfernen"): takes one earned badge back from a member with a reason.
 * Atom `moderation.decide`, audited `badge.revoked` (before: when and how it was earned; never the member's other badges). Removes the
 * user_badges row and the member's still unread `badge_unlocked` notification of that badge (a read one stays in their history). The
 * badge is not blocked: the next nightly run, an action or "Jetzt anwenden" awards it again when the rule still holds for the member,
 * so the abuse itself (spots, mods) has to be removed first. Idempotent: a badge the member does not hold answers 422 on `badge`.
 */
final class RevokeBadge
{
    public function handle(Staff $staff, User $member, string $badgeKey, string $reason): void
    {
        StaffAtoms::ensure($staff, 'moderation.decide');

        if (! self::take($member, $badgeKey, trim($reason), $staff)) {
            throw ValidationException::withMessages(['badge' => [(string) __('validation.exists', ['attribute' => 'badge'])]]);
        }
    }

    /**
     * The core without the atom: removes the earned row and the still unread unlock notification, audits `badge.revoked` (by $staff, or
     * by the system when null: the ADR-516 b migration that retires `nachtschicht`). Never pushes. False when the member does not hold
     * the badge (nothing changes, nothing is audited).
     */
    public static function take(User $member, string $badgeKey, string $reason, ?Staff $staff): bool
    {
        return DB::transaction(function () use ($staff, $member, $badgeKey, $reason): bool {
            $earned = UserBadge::query()->where('user_id', $member->id)->where('badge_key', $badgeKey)->lockForUpdate()->first();

            if (! $earned instanceof UserBadge) {
                return false;
            }

            $before = [
                'badge_key' => $earned->badge_key,
                'awarded_at' => $earned->awarded_at->toIso8601String(),
                'source_ref' => $earned->source_ref,
            ];

            $earned->delete();
            $notifications = Notification::query()
                ->where('notifiable_id', $member->id)
                ->where('type', NotificationType::BadgeUnlocked)
                ->where('group_key', 'badge_unlocked:'.$badgeKey)
                ->whereNull('read_at')
                ->delete();

            $badge = Badge::query()->find($badgeKey);
            Audit::record(GiftEvent::BadgeRevoked->value, $member, $before, ['badge_key' => $badgeKey, 'badge' => $badge?->name_de, 'notification_removed' => $notifications > 0], $reason, $staff);

            return true;
        });
    }
}
