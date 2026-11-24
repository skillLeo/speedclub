<?php

namespace App\Services\Notifications;

use App\Enums\NotificationType;
use App\Models\Notification;
use App\Models\User;
use App\Services\Insights\EngagementCounters;
use Carbon\CarbonImmutable;
use Carbon\CarbonInterface;
use Illuminate\Support\Facades\Cache;
use Illuminate\Support\Facades\DB;

/**
 * M5.7 (10 §6 "max 3 engagement pushes/week per user", 10 §16, m5.7-contract §8.3): the pushes the system starts on its own — prompts and
 * summaries, not a person's act towards the member — push at most `notifications.engagement_weekly_max` (3) times per member and ISO week
 * (Monday to Sunday, Europe/Berlin) across all of them. A row beyond that stays in the in-app list without a push.
 *
 * A claim is one of the week's slots in engagement_push_claims: insertOrIgnore on the unique (user_id, week, slot) for slot 1, 2, 3 —
 * the first insert that lands wins, so two writers at the same moment can never use a fourth push, without a lock. releaseSlot() gives
 * exactly that slot back when the row did not push after all. Not in it: messages, follows, reactions, mentions, comments, forum replies, event
 * reminders and updates, maintenance and HU/AU reminders (the member's own schedule), security and moderation, the owner's own Car of
 * the Day (ADR-513) and accepted invites (a person's act).
 */
final class EngagementPushLimiter
{
    /**
     * The notification type values the cap covers (D-6). event_nearby (M5.6, "Neue Treffen in deiner Nähe") is a weekly push the system
     * starts itself, so the cap covers it too (lead-approved); it also stays under the daily social limit.
     */
    public const TYPES = ['plan_due', 'weekly_recap', 'badge_unlocked', 'car_of_the_day', 'spot_alert', 'qr_milestone', 'build_saved', 'event_nearby'];

    public static function governs(NotificationType $type): bool
    {
        return in_array($type->value, self::TYPES, true);
    }

    /**
     * Takes one of the member's engagement pushes of the week for $row; false when the week's pushes are used up.
     */
    public function claim(User $user, Notification $row, ?CarbonInterface $at = null): bool
    {
        return $this->claimSlot($user, $row, $at) !== null;
    }

    /**
     * SF-3 (review M5.6/M5.7): like claim(), but answers the slot taken, so releaseSlot() gives back exactly that one and never an earlier
     * push's slot of the same row (a grouped row that pushed before and comes back inside its cooldown, or two parallel writers).
     */
    public function claimSlot(User $user, Notification $row, ?CarbonInterface $at = null): ?int
    {
        $week = $this->week($at);

        for ($slot = 1; $slot <= $this->max(); $slot++) {
            $taken = DB::table('engagement_push_claims')->insertOrIgnore([
                'user_id' => $user->id,
                'week' => $week,
                'slot' => $slot,
                'type' => $row->type->value,
                'notification_id' => $row->id,
                'created_at' => now(),
            ]);

            if ($taken === 1) {
                return $slot;
            }
        }

        // ADM-70 Insights overview: the platform count of pushes the cap dropped (no member stored). SF-4: once per notification row and
        // week, however often a later run tries that row again.
        if (Cache::add('engagement:dropped:'.$week.':'.$row->id, true, now()->addDays(8))) {
            EngagementCounters::bump(EngagementCounters::PUSH_DROPPED);
        }

        return null;
    }

    /**
     * Gives back exactly the slot claimSlot() took, when that push did not go out after all.
     */
    public function releaseSlot(User $user, int $slot, ?CarbonInterface $at = null): void
    {
        DB::table('engagement_push_claims')->where('user_id', $user->id)->where('week', $this->week($at))->where('slot', $slot)->delete();
    }

    /**
     * SF-4: whether the member's engagement pushes of the week are used up (a retry would be dropped anyway).
     */
    public function exhausted(User $user, ?CarbonInterface $at = null): bool
    {
        return $this->used($user, $at) >= $this->max();
    }

    /**
     * How many of the week's engagement pushes the member got.
     */
    public function used(User $user, ?CarbonInterface $at = null): int
    {
        return DB::table('engagement_push_claims')->where('user_id', $user->id)->where('week', $this->week($at))->count();
    }

    private function max(): int
    {
        return max(0, min(3, config()->integer('speedclub.notifications.engagement_weekly_max', 3)));
    }

    /**
     * The Monday of the ISO week, Europe/Berlin.
     */
    private function week(?CarbonInterface $at): string
    {
        return CarbonImmutable::instance($at ?? CarbonImmutable::now())
            ->setTimezone(config()->string('speedclub.notifications.timezone'))
            ->startOfWeek(CarbonInterface::MONDAY)
            ->toDateString();
    }
}
