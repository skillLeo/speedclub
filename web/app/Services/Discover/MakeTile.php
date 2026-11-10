<?php

namespace App\Services\Discover;

/**
 * A text tile of "Marken" (FS-11): the catalogue make and the real number of public builds the viewer can find for it.
 */
final readonly class MakeTile
{
    public function __construct(
        public int $id,
        public string $name,
        public string $slug,
        public int $vehicleCount,
    ) {}
}
