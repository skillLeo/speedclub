<?php

namespace App\Services\Home;

/**
 * A chip of "Beliebte Mods diese Woche": a brand ("BBS") or a brand with its part ("KW V3"). No counts leave the server.
 */
final readonly class PopularMod
{
    public function __construct(
        public string $label,
        public ?string $categoryKey,
        public string $query,
    ) {}
}
