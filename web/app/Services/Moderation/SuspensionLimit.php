<?php

namespace App\Services\Moderation;

use App\Models\Staff;
use Carbon\CarbonImmutable;
use Carbon\CarbonInterface;

/**
 * 06_ADMIN_SPEC §2: a moderator suspends for at most 30 days, Owner and Admin without limit (m3.2-contract §1). Checked when the
 * suspension is asked for and again in DecisionInput, so the approval of a longer one fails. The end of the 30th day in Berlin counts,
 * so "30 Tage" picked in the admin passes after the approval waited a few hours. The operator command's staff (no role) are not
 * moderators and keep their documented attestation (ADR-206 a).
 */
final class SuspensionLimit
{
    public const MODERATOR_MAX_DAYS = 30;

    public static function isLimited(Staff $staff): bool
    {
        return $staff->hasRole('moderator') && ! $staff->hasAnyRole(['owner', 'admin']);
    }

    public static function latestEnd(?CarbonInterface $now = null): CarbonImmutable
    {
        $zone = config()->string('speedclub.display_timezone');

        return CarbonImmutable::instance($now ?? now())->setTimezone($zone)->addDays(self::MODERATOR_MAX_DAYS)->endOfDay();
    }

    /**
     * Whether $staff may suspend until $until (null: no end date).
     */
    public static function allows(Staff $staff, ?CarbonInterface $until): bool
    {
        if (! self::isLimited($staff)) {
            return true;
        }

        return $until !== null && $until->lessThanOrEqualTo(self::latestEnd());
    }
}
