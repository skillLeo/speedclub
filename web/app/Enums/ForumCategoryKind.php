<?php

namespace App\Enums;

use App\Support\Enums\HasLabel;

/**
 * M5.8 (m5.8-contract §1): an admin-managed category, a sub-category generated per catalogue make ("Marken & Modelle") or one per
 * Bundesland ("Treffen & Regionen").
 */
enum ForumCategoryKind: string
{
    use HasLabel;

    case Standard = 'standard';
    case Make = 'make';
    case Region = 'region';
}
