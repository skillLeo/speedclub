<?php

namespace App\Enums;

/**
 * CF-6 (VEH-07): the square share card's band, bg-canvas of the carbon or the light theme.
 */
enum ShareCardTheme: string
{
    case Dark = 'dark';
    case Light = 'light';
}
