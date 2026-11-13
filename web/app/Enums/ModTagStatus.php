<?php

namespace App\Enums;

use App\Support\Enums\HasLabel;

/**
 * "Eingebaut von" (09 §8.10, ADR-414): a tag of a business on a mod is pending until the other side confirms it (accepted) or declines
 * it. Only an accepted tag reaches the business page and the mod's public face.
 */
enum ModTagStatus: string
{
    use HasLabel;

    case Pending = 'pending';
    case Accepted = 'accepted';
    case Declined = 'declined';
}
