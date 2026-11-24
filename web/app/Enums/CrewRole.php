<?php

namespace App\Enums;

/**
 * R4-2.3: exactly one founder per crew (kept by the Actions), any number of admins and members. The rank is the member list's order.
 */
enum CrewRole: string
{
    case Founder = 'founder';
    case Admin = 'admin';
    case Member = 'member';

    public function rank(): int
    {
        return match ($this) {
            self::Founder => 0,
            self::Admin => 1,
            self::Member => 2,
        };
    }

    /**
     * Founder and admins run the crew: edit it, invite, approve requests.
     */
    public function runsCrew(): bool
    {
        return $this !== self::Member;
    }
}
