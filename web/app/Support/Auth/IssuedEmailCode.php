<?php

namespace App\Support\Auth;

/**
 * A code that was just written (EmailCodes::issue): the plain code and magic token exist only here, on their way into the mail.
 */
final readonly class IssuedEmailCode
{
    public function __construct(
        public string $email,
        #[\SensitiveParameter] public string $code,
        #[\SensitiveParameter] public ?string $magicToken = null,
    ) {}
}
