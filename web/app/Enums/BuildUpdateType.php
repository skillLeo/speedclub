<?php

namespace App\Enums;

use App\Support\Enums\HasLabel;

enum BuildUpdateType: string
{
    use HasLabel;

    case ModAdded = 'mod_added';
    case ModChanged = 'mod_changed';
    case ModRemoved = 'mod_removed';
    case SpecsChanged = 'specs_changed';
    case PhotosAdded = 'photos_added';
    case Note = 'note';
}
