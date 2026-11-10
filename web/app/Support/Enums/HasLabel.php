<?php

namespace App\Support\Enums;

use Illuminate\Support\Str;

/**
 * Translated enum labels from lang/{de,en}/enums.php, grouped by the enum name in snake case.
 */
trait HasLabel
{
    public function label(?string $locale = null): string
    {
        $key = 'enums.'.Str::snake(class_basename(self::class)).'.'.$this->value;
        $label = trans($key, [], $locale);

        return is_string($label) ? $label : $key;
    }
}
