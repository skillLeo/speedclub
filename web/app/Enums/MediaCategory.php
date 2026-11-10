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
}
