<?php

namespace App\Enums;

use App\Support\Enums\HasLabel;

enum ModFieldType: string
{
    use HasLabel;

    case Text = 'text';
    case Number = 'number';
    case Boolean = 'boolean';
    case Select = 'select';
    case Brand = 'brand';
}
