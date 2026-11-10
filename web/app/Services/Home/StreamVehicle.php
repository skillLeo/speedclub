<?php

namespace App\Services\Home;

/**
 * A build of the Für dich stream, as ranked: vehicle_search.rank_score, then when it last changed (vehicle_search.updated_at), then
 * vehicle_id, all descending. Builds older than about two months score 0 (the decay rounds away), so among them recency decides.
 */
final readonly class StreamVehicle
{
    public function __construct(
        public string $id,
        /** StreamCursor::ownerKey() of the owner. */
        public string $ownerId,
        public string $score,
        public string $changedAt,
    ) {}
}
