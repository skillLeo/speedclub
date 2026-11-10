<?php

namespace App\Services\Home;

/**
 * An update row of the Für dich stream: the latest visible build update of a build, newest first (created_at, then id).
 */
final readonly class StreamUpdate
{
    public function __construct(
        public string $id,
        public string $vehicleId,
        /** StreamCursor::ownerKey() of the owner. */
        public string $ownerId,
        public string $at,
    ) {}
}
