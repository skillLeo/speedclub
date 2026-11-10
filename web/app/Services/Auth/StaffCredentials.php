<?php

namespace App\Services\Auth;

use App\Models\Staff;
use App\Support\ViewAs;
use Illuminate\Contracts\Session\Session;
use Illuminate\Support\Str;

/**
 * SEC-P1-25: one value per staff account that changes with every password change or reset and every change of the second factor.
 * A session keeps the value it signed in with (remember()); EnsureStaffActive ends every session whose value is stale, so a reset or a
 * key rotation throws out whoever else held a session. The session that made the change keeps going: it passes its own session to
 * rotate(), and every view-as the staff member started ends (SEC-P3-07). A session that has no value yet (from before M3.1, or a test's actingAs) adopts the current one on its next request.
 */
final class StaffCredentials
{
    public const SESSION_KEY = 'staff.credentials_epoch';

    /**
     * Written at once, also inside a caller's transaction.
     */
    public static function rotate(Staff $staff, ?Session $keep = null): void
    {
        $epoch = Str::random(32);

        Staff::query()->whereKey($staff->getKey())->toBase()->update(['credentials_epoch' => $epoch]);
        $staff->setAttribute('credentials_epoch', $epoch);
        $staff->syncOriginalAttribute('credentials_epoch');

        if ($keep !== null) {
            self::remember($staff, $keep);
        }

        // A view-as the staff member started ends with their old credentials (SEC-P3-07).
        ViewAs::revokeStartedBy($staff, 'staff_credentials_changed');
    }

    public static function remember(Staff $staff, Session $session): void
    {
        $session->put(self::SESSION_KEY, self::current($staff));
    }

    /**
     * Whether the session still belongs to the current credentials. Adopts the current value when the session has none.
     */
    public static function holds(Staff $staff, Session $session): bool
    {
        $stored = $session->get(self::SESSION_KEY);

        if (! is_string($stored)) {
            self::remember($staff, $session);

            return true;
        }

        return hash_equals(self::current($staff), $stored);
    }

    private static function current(Staff $staff): string
    {
        $epoch = $staff->getAttribute('credentials_epoch');

        // A non-empty marker for "never changed", so a stored value is always a string.
        return is_string($epoch) && $epoch !== '' ? $epoch : '-';
    }
}
