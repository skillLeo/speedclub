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
    /** @param  bool  $staff  ADM-10: any length up to staff_max_length, reserved words allowed (client round 2). */
    public function __construct(private readonly bool $staff = false) {}

    /**
     * @param  Closure(string, ?string=): PotentiallyTranslatedString  $fail
     */
    public function validate(string $attribute, mixed $value, Closure $fail): void
    {
        if (! is_string($value)) {
            $fail('username.characters')->translate();

            return;
        }

        foreach (Username::violations($value, $this->staff) as $violation) {
            $fail("username.$violation")->translate([
                'min' => $this->staff ? 1 : config()->integer('speedclub.usernames.min_length'),
                'max' => config()->integer($this->staff ? 'speedclub.usernames.staff_max_length' : 'speedclub.usernames.max_length'),
            ]);
        }
    }
}
