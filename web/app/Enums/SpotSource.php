<?php

namespace App\Enums;

/**
 * M5.9b (contract §1): where a spot came from. Only the in-app scanner creates spots; a web scan of /c/{code} stays a view.
 */
enum SpotSource: string
{
    case Scanner = 'scanner';
}
