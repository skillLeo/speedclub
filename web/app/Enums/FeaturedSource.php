<?php

namespace App\Enums;

/**
 * Why a build is in the featured slot of HOME-01: named by the editorial list (speedclub.home.featured_slugs, later ADM), or picked
 * as one of the most complete public builds when the list leaves a slot empty.
 */
enum FeaturedSource: string
{
    case Editorial = 'editorial';
    case Completeness = 'completeness';
}
