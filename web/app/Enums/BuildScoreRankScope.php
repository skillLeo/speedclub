<?php

namespace App\Enums;

/**
 * M5.9c (m5.9c contract §3): the groups a Build Score is ranked in, nightly: cars of the same generation in Germany, and cars whose
 * owners live in the same Bundesland (users.bundesland).
 */
enum BuildScoreRankScope: string
{
    case Generation = 'generation';
    case Bundesland = 'bundesland';
}
