<?php

namespace App\Support\Security;

use Carbon\CarbonImmutable;

/**
 * What a security notice adds besides its type (09 §8.4): the SET-21 row it belongs to, the "Das war ich nicht" link, the approximate
 * place (only with a GeoLite2 database, OA-33), the moment, and the install whose push token must not get the alert (the new device).
 */
final readonly class SecurityAlert
{
    public function __construct(
        public ?string $eventId = null,
        public ?string $secureUrl = null,
        public ?string $place = null,
        public ?CarbonImmutable $at = null,
        public ?string $pushExceptInstall = null,
        // The support request "Das war ich nicht" opened (SC-…).
        public ?string $reference = null,
        /** @var array{passkeys: int, providers: int, email_change: bool, two_factor: bool}|null what securing the account removed (SEC-M47-01) */
        public ?array $removed = null,
    ) {}
}
