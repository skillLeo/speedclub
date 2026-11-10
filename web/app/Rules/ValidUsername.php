<?php

namespace App\Rules;

use App\Support\Username;
use Closure;
use Illuminate\Contracts\Validation\ValidationRule;
use Illuminate\Translation\PotentiallyTranslatedString;

/**
 * Format and reserved-list rules only. Combine with a unique rule on users.username.
 */
class ValidUsername implements ValidationRule
{
    /**
     * @param  Closure(string, ?string=): PotentiallyTranslatedString  $fail
     */
    public function validate(string $attribute, mixed $value, Closure $fail): void
    {
        if (! is_string($value)) {
            $fail('username.characters')->translate();

            return;
        }

        foreach (Username::violations($value) as $violation) {
            $fail("username.$violation")->translate([
                'min' => config()->integer('speedclub.usernames.min_length'),
                'max' => config()->integer('speedclub.usernames.max_length'),
            ]);
        }
    }
}
