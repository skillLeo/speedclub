<?php

namespace App\Enums;

/**
 * What an owner can pin to a vehicle's Highlights rail (09 §8.5): a build update or a photo of the build. The value is what the API and the table use.
 */
enum HighlightItemType: string
{
    case BuildUpdate = 'build_update';
    case Photo = 'photo';
}
