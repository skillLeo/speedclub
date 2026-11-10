<?php

namespace App\Services\Notifications;

use App\Models\User;
use Carbon\CarbonImmutable;
use Carbon\CarbonInterface;

/**
 * Quiet hours (02_PRODUCT_SPEC §7): 22:00–07:00 by default, on by default, in Europe/Berlin (speedclub.notifications.timezone), whatever
 * the device's zone. Inside them non-urgent pushes are dropped; the in-app row stays. A window may run over midnight ("22:00"–"07:00") or
 * not ("13:00"–"14:00"); from equal to to is an empty window. The start minute is inside, the end minute is not.
 */
final class QuietHours
{
    public static function active(User $user, ?CarbonInterface $at = null): bool
    {
        $quiet = NotificationPrefs::for($user)['quiet_hours'];

        if (! $quiet['enabled']) {
            return false;
        }

        return self::inside($quiet['from'], $quiet['to'], $at ?? CarbonImmutable::now());
    }

    public static function inside(string $from, string $to, CarbonInterface $at): bool
    {
        $local = CarbonImmutable::instance($at)->setTimezone(config()->string('speedclub.notifications.timezone'));
        $minute = $local->hour * 60 + $local->minute;
        $start = self::minutes($from);
        $end = self::minutes($to);

        if ($start === $end) {
            return false;
        }

        return $start < $end
            ? $minute >= $start && $minute < $end
            : $minute >= $start || $minute < $end;
    }

    private static function minutes(string $time): int
    {
        [$hours, $minutes] = array_map(intval(...), explode(':', $time) + [0, 0]);

        return $hours * 60 + $minutes;
    }
}
