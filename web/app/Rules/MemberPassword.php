<?php

namespace App\Rules;

use App\Support\CommonPasswords;
use App\Support\PasswordShape;
use Closure;
use Illuminate\Contracts\Validation\ValidationRule;
use Illuminate\Translation\PotentiallyTranslatedString;

/**
 * 02_PRODUCT_SPEC §3.1. Every broken rule gets its own message; there is no score. The username check happens after the
 * code check in the reset action, because here it would tell an anonymous caller which username goes with an address.
 */
class MemberPassword implements ValidationRule
{
    public function __construct(private readonly ?string $email = null) {}

    /**
     * @param  Closure(string, ?string=): PotentiallyTranslatedString  $fail
     */
    public function validate(string $attribute, mixed $value, Closure $fail): void
    {
        if (! is_string($value)) {
            $fail('passwords.rules.length')->translate(['min' => config()->integer('speedclub.passwords.min_length')]);

            return;
        }

        if (mb_strlen($value) < config()->integer('speedclub.passwords.min_length')) {
            $fail('passwords.rules.length')->translate(['min' => config()->integer('speedclub.passwords.min_length')]);
        }

        if (mb_strlen($value) > config()->integer('speedclub.passwords.max_length')) {
            $fail('passwords.rules.too_long')->translate(['max' => config()->integer('speedclub.passwords.max_length')]);
        }

        if (CommonPasswords::contains($value)) {
            $fail('passwords.rules.common')->translate();
        }

        if (PasswordShape::looksHashed($value)) {
            $fail('passwords.rules.hash_shaped')->translate();
        }

        if ($this->email !== null && mb_strtolower($value) === mb_strtolower($this->email)) {
            $fail('passwords.rules.same_as_email')->translate();
        }
    }
}
