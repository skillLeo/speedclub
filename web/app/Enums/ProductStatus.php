<?php

namespace App\Enums;

use App\Support\Enums\HasLabel;

/**
 * Products of the parts catalogue (09 §8.9, ADM-57): active ones are listed, searched and linkable in the mod editor; archived ones
 * stay on the mods that link them (their name still shows) but leave search and the brand pages.
 */
enum ProductStatus: string
{
    use HasLabel;

    case Active = 'active';
    case Archived = 'archived';
}
