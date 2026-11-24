<?php

namespace App\Enums;

use App\Support\Enums\HasLabel;

/**
 * Private reactions on builds and build updates (09 §8.5, ADR-413): Gefällt mir · Stark · Sauber · Tief · Laut, one per member and item.
 * "Gefällt mir" (client round 4, 11 R4-2.2) is the one-tap heart the app shows first; the others are the car reactions behind it. The
 * app draws them with its own glyphs. Counts reach the owner only, never anybody else.
 */
enum ReactionType: string
{
    use HasLabel;

    case Like = 'like';
    case Strong = 'strong';
    case Clean = 'clean';
    case Low = 'low';
    case Loud = 'loud';
}
