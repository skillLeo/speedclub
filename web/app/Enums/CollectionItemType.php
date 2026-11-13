<?php

namespace App\Enums;

/**
 * What a private collection holds (09 §8.6): builds, mods, build updates and events (M4.12) and businesses (M4.14). The value is
 * the morph name stored in member_collection_items.item_type.
 */
enum CollectionItemType: string
{
    case Vehicle = 'vehicle';
    case Modification = 'modification';
    case BuildUpdate = 'build_update';
    case Event = 'event';
    case Business = 'business';
}
