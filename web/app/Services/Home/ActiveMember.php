<?php

namespace App\Services\Home;

use App\Models\User;

/**
 * A member of the "Aktive Mitglieder" strip or of the suggestions of an empty "Folge ich".
 */
final readonly class ActiveMember
{
    public function __construct(
        public User $member,
        public ?string $carLine,
        public bool $isFollowing,
        public ?string $carShort = null,
    ) {}
}
