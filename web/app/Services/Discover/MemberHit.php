<?php

namespace App\Services\Discover;

use App\Models\User;

/**
 * A member result of DISC-02 with the garage summary of 02_PRODUCT_SPEC §3.7 ("3 Fahrzeuge · BMW, Nissan"). username and relevance
 * are the cursor's columns.
 */
final class MemberHit
{
    /**
     * @param  list<string>  $makes
     */
    public function __construct(
        public readonly User $member,
        public readonly string $username,
        public readonly int $relevance,
        public int $vehicleCount = 0,
        public array $makes = [],
        public bool $isFollowing = false,
    ) {}
}
