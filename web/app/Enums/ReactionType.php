<?php

namespace App\Enums;

use App\Support\Enums\HasLabel;

/**
 * Private reactions on builds and build updates (09 §8.5, ADR-413): Stark · Sauber · Tief · Laut, one per member and item. The app draws
 * them with its own glyphs (strong, clean, low, loud). Counts reach the owner only, never anybody else.
 */
enum ReactionType: string
{
    use HasLabel;

    case Strong = 'strong';
    case Clean = 'clean';
    case Low = 'low';
    case Loud = 'loud';
}
