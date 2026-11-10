<?php

namespace App\Services\Discover;

use App\Enums\FeaturedSource;
use App\Models\Vehicle;

/**
 * One slot of the featured hero of FS-2 and where it came from.
 */
final readonly class FeaturedBuild
{
    public function __construct(
        public Vehicle $vehicle,
        public FeaturedSource $source,
    ) {}
}
