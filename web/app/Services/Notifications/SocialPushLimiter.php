<?php

namespace App\Services\Notifications;

use App\Enums\NotificationType;
use App\Models\Notification;
use App\Models\User;
use Carbon\CarbonImmutable;
use Carbon\CarbonInterface;
use Illuminate\Support\Facades\DB;

/**
 * The shared social push limit of the Phase 5 gifts (10 §16, owner gift detail M5.9b/M5.9d): the types in TYPES push at most once per
 * member and Europe/Berlin day across all of them; any further row of these types stays in the in-app list without a push. They never push between 22:00 and 08:00
 * (`social_quiet_hours`), whatever the member chose; the member's own quiet hours apply on top (Notifier checks them for every type).
 *
 * Notifier::maybePush asks quiet() before and claim() right before it marks a row pushed; claim() takes the member's day in
 * social_push_claims, whose unique (user_id, day) key decides between two writers at the same moment. release() gives the day back when
 * the row was not pushed after all. M5.9d adds its enum cases with these values and gets the limit without further code.
 */
final class SocialPushLimiter
{
    /** The notification type values the limit covers. */
    public const TYPES = ['spot_alert', 'badge_unlocked', 'car_of_the_day', 'invite_accepted',
        // M5.6 (m5.6-contract §6): the weekly nearby meets, an engagement push under the same daily limit and night quiet.
        'event_nearby'];

    /**
     * Types outside the daily limit that still never push 22:00–08:00: the owner's own Car of the Day (ADR-513 keeps it out of the
     * limit; the owner's rule "quiet hours 22–08" covers every gift push, and a staff replacement late in the evening would otherwise
     * push at night). The row stays in the in-app list.
     */
    // M5.7 (m5.7-contract §8.3): the build prompt and the weekly recap are not social, so outside the daily limit, but never push at
    // night either; they count against the weekly engagement cap (EngagementPushLimiter).
    public const QUIET_ONLY = ['car_of_the_day_owner', 'plan_due', 'weekly_recap'];

    /** Claims are kept this long (support questions), then pruned with the notifications. */
    public const KEEP_DAYS = 7;

    public static function governs(NotificationType $type): bool
    {
        return in_array($type->value, self::TYPES, true);
    }

    /**
     * Whether $type never pushes inside the fixed social quiet window: every limited type and QUIET_ONLY.
     */
    public static function keepsNightQuiet(NotificationType $type): bool
    {
        return self::governs($type) || in_array($type->value, self::QUIET_ONLY, true);
    }

    /**
     * Inside the fixed social quiet window (22:00–08:00 Europe/Berlin by default).
     */
    public function quiet(?CarbonInterface $at = null): bool
    {
        $window = config()->array('speedclub.notifications.social_quiet_hours');

        return QuietHours::inside((string) ($window['from'] ?? '22:00'), (string) ($window['to'] ?? '08:00'), $at ?? CarbonImmutable::now());
    }

    /**
     * Takes one of the member's social pushes of the day for $row; false when the day's pushes are used up.
     */
    public function claim(User $user, Notification $row, ?CarbonInterface $at = null): bool
    {
        return DB::table('social_push_claims')->insertOrIgnore([
            'user_id' => $user->id,
            'day' => $this->day($at),
            'type' => $row->type->value,
            'notification_id' => $row->id,
            'created_at' => now(),
        ]) === 1;
    }

    /**
     * Gives the day back when the claimed row did not push after all (another writer pushed the same row within its cooldown).
     */
    public function release(User $user, Notification $row, ?CarbonInterface $at = null): void
    {
        DB::table('social_push_claims')->where('user_id', $user->id)->where('day', $this->day($at))->where('notification_id', $row->id)->delete();
    }

    /**
     * Whether the member's social push of the day is used.
     */
    public function used(User $user, ?CarbonInterface $at = null): bool
    {
        return DB::table('social_push_claims')->where('user_id', $user->id)->where('day', $this->day($at))->exists();
    }

    /**
     * Deletes claims older than KEEP_DAYS; returns how many.
     */
    public function prune(): int
    {
        return DB::table('social_push_claims')->where('day', '<', CarbonImmutable::now($this->zone())->subDays(self::KEEP_DAYS)->toDateString())->delete();
    }

    private function day(?CarbonInterface $at): string
    {
        return CarbonImmutable::instance($at ?? CarbonImmutable::now())->setTimezone($this->zone())->toDateString();
    }

    private function zone(): string
    {
        return config()->string('speedclub.notifications.timezone');
    }
}
