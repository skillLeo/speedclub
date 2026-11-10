<?php

namespace App\Actions\Admin\Account;

use App\Models\Staff;
use App\Services\Team\TeamRefused;
use Illuminate\Contracts\Session\Session;

/**
 * The pending key of a TOTP rotation, for the session that started it and within its time (SEC-P1-33 for rotations).
 */
final class PendingRotation
{
    /**
     * @throws TeamRefused
     */
    public static function of(Staff $staff, Session $session): string
    {
        $secret = $staff->two_factor_pending_secret;
        $started = $staff->two_factor_pending_at;

        if (! is_string($secret) || $secret === '' || $started === null) {
            throw new TeamRefused('no_rotation');
        }

        if (! hash_equals((string) $staff->two_factor_pending_session, StartTotpRotation::sessionHash($session))) {
            throw new TeamRefused('rotation_elsewhere');
        }

        if ($started->copy()->addMinutes(config()->integer('speedclub.team.rotation_minutes'))->isPast()) {
            throw new TeamRefused('rotation_expired');
        }

        return $secret;
    }

    /** Whether a rotation is pending for ADM-51 (never the key). */
    public static function exists(Staff $staff): bool
    {
        return $staff->two_factor_pending_at !== null
            && $staff->two_factor_pending_at->copy()->addMinutes(config()->integer('speedclub.team.rotation_minutes'))->isFuture();
    }
}
