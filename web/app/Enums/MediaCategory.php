<?php

namespace App\Enums;

use App\Support\Enums\HasLabel;

enum MediaCategory: string
{
    use HasLabel;

    case Exterior = 'exterior';
    case Interior = 'interior';
    case Engine = 'engine';
    case Wheels = 'wheels';
    case Detail = 'detail';
    case Other = 'other';
    // M5.6 (m5.6-contract §4.1): a photo of an event's gallery.
    case Event = 'event';
}
