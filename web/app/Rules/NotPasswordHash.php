<?php

namespace App\Rules;

use App\Support\PasswordShape;
use Closure;
use Illuminate\Contracts\Validation\ValidationRule;
use Illuminate\Translation\PotentiallyTranslatedString;

/**
 * For password fields that do not use MemberPassword, which has this check built in: the staff forms.
 */
class NotPasswordHash implements ValidationRule
{
    /**
     * @param  Closure(string, ?string=): PotentiallyTranslatedString  $fail
     */
    public function validate(string $attribute, mixed $value, Closure $fail): void
    {
        if (is_string($value) && PasswordShape::looksHashed($value)) {
            $fail('passwords.rules.hash_shaped')->translate();
        }
    }
}
