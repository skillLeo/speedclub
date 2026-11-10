<?php

namespace App\Services\Admin\Members;

use App\Models\Staff;
use Illuminate\Auth\Access\AuthorizationException;

/**
 * The admin Actions of M3.2 check the permission atom themselves (m3.2-contract §1a), whatever the controller already did, so no
 * other caller (a command, a bulk run, an approval handler) can run them without it.
 */
final class StaffAtoms
{
    /**
     * @throws AuthorizationException
     */
    public static function ensure(Staff $staff, string ...$atoms): void
    {
        if (! $staff->isActive()) {
            throw new AuthorizationException;
        }

        foreach ($atoms as $atom) {
            if (! $staff->can($atom)) {
                throw new AuthorizationException;
            }
        }
    }

    /**
     * A four-eyes executor: requester and approver both hold the atoms, and they are two people.
     *
     * @throws AuthorizationException
     */
    public static function ensurePair(Staff $requester, Staff $approver, string ...$atoms): void
    {
        if ($requester->getKey() === $approver->getKey()) {
            throw new AuthorizationException;
        }

        self::ensure($requester, ...$atoms);
        self::ensure($approver, ...$atoms);
    }
}
