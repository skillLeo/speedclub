<?php

namespace App\Enums;

/**
 * M5.9d badges (m5.9d contract §2, §10.2): the three tiers the app draws.
 */
enum BadgeTier: string
{
    case Bronze = 'bronze';
    case Silver = 'silver';
    case Gold = 'gold';
}
