<?php

namespace App\Enums;

/**
 * M5.9d badges (m5.9d contract §2): the groups of the badge row and the admin badge manager.
 */
enum BadgeCategory: string
{
    case Garage = 'garage';
    case Mods = 'mods';
    case Spotting = 'spotting';
    case Sets = 'sets';
    case Treffen = 'treffen';
    case Forum = 'forum';
    case Sticker = 'sticker';
    case Founding = 'founding';
    case Community = 'community';
}
