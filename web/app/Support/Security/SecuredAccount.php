<?php

namespace App\Support\Security;

/**
 * The outcome of "Das war ich nicht" (SecureAccount).
 */
final readonly class SecuredAccount
{
    public function __construct(
        public string $reference,
        public int $devices,
        public int $sessions,
        public bool $passwordReset,
        /** @var array{passkeys: int, providers: int, email_change: bool, two_factor: bool} what SEC-M47-01 removed */
        public array $removed = ['passkeys' => 0, 'providers' => 0, 'email_change' => false, 'two_factor' => false],
    ) {}
}
