<?php

namespace App\Services\Discover;

use App\Enums\SearchSort;
use App\Models\Media;

/**
 * A collection as DISC-01 shows it (Collections).
 */
final readonly class CollectionCard
{
    /**
     * @param  array<string, mixed>  $filters  the query parameters of search/vehicles
     */
    public function __construct(
        public string $key,
        public string $title,
        public ?string $subtitle,
        public ?Media $cover,
        public array $filters,
        public ?SearchSort $sort,
        public int $count,
        public bool $countCapped,
    ) {}
}
