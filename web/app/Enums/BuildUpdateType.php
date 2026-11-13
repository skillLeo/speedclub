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
    // M4.11 (09 §8.5): an update the owner posts (UPD-01) with text, photos, linked mods, mileage and date; never merged.
    case Post = 'post';

    /**
     * Written by the owner, not recorded from a change.
     */
    public function isAuthored(): bool
    {
        return $this === self::Note || $this === self::Post;
    }
}
