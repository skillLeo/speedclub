<?php

namespace App\Services\Maintenance;

use App\Models\User;

/**
 * users.maintenance_prefs (SET-23 = MNT-03, 09 §7.9): the reminder defaults of the member. Stored as what the member changed, read merged
 * over DEFAULTS, like NotificationPrefs. hu_au_lead_days: the lead times a new HU/AU item starts with (30/14/1 days); the three switches
 * silence the tyre change (O bis O), the insurance Stichtag and the service-type reminders (service, oil, brake fluid, custom). Whether a
 * reminder goes out by push or e-mail at all is SET-09's "Fälligkeiten" row (notification_prefs.types.hu_au_reminder).
 *
 * @phpstan-type Prefs array{hu_au_lead_days: list<int>, tyre_reminders: bool, insurance_reminder: bool, service_reminders: bool}
 */
final class MaintenancePrefs
{
    public const DEFAULTS = [
        'hu_au_lead_days' => [30, 14, 1],
        'tyre_reminders' => true,
        'insurance_reminder' => true,
        'service_reminders' => true,
    ];

    /** Lead times: 0 (the day itself) to 90 days, at most three. */
    public const MAX_LEAD_DAYS = 90;

    public const MAX_LEADS = 3;

    /**
     * @return Prefs
     */
    public static function for(User $user): array
    {
        /** @var mixed $stored */
        $stored = $user->getAttribute('maintenance_prefs');

        return self::merge(self::DEFAULTS, is_array($stored) ? $stored : []);
    }

    /**
     * @param  Prefs  $prefs
     * @param  array<mixed>  $patch
     * @return Prefs
     */
    public static function merge(array $prefs, array $patch): array
    {
        if (is_array($patch['hu_au_lead_days'] ?? null)) {
            $days = self::leadDays($patch['hu_au_lead_days']);

            if ($days !== []) {
                $prefs['hu_au_lead_days'] = $days;
            }
        }

        foreach (['tyre_reminders', 'insurance_reminder', 'service_reminders'] as $key) {
            if (is_bool($patch[$key] ?? null)) {
                $prefs[$key] = $patch[$key];
            }
        }

        return $prefs;
    }

    /**
     * Longest first, without repeats, only whole days in range, at most MAX_LEADS.
     *
     * @param  array<mixed>  $days
     * @return list<int>
     */
    public static function leadDays(array $days): array
    {
        $valid = array_values(array_unique(array_filter($days, fn (mixed $day): bool => is_int($day) && $day >= 0 && $day <= self::MAX_LEAD_DAYS)));
        rsort($valid);

        return array_slice($valid, 0, self::MAX_LEADS);
    }

    /**
     * Whether the member's SET-23 switch lets this type remind.
     */
    public static function allows(User $user, ?string $preference): bool
    {
        return $preference === null || (self::for($user)[$preference] ?? true) === true;
    }
}
