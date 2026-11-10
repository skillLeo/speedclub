<?php

namespace App\Http\Requests\Api\V1\Auth\Concerns;

use App\Support\EmailAddress;

/**
 * Addresses are stored in one form (05_ARCHITECTURE §6, EmailAddress): lowercased, the domain in ASCII. Every lookup uses the same
 * form, so max@müller.de from the app and max@xn--mller-kva.de from a browser are one account.
 */
trait NormalizesEmail
{
    protected function prepareForValidation(): void
    {
        $email = $this->input('email');

        if (is_string($email)) {
            $this->merge(['email' => EmailAddress::normalize($email)]);
        }
    }

    /**
     * Safe before validation, because password rules are built from it: a non-string address reads as empty and the
     * email rule then answers 422.
     */
    public function email(): string
    {
        $email = $this->input('email');

        return is_string($email) ? $email : '';
    }
}
