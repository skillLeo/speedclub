<?php

namespace App\Support\Auth;

use App\Enums\SessionKind;
use Carbon\CarbonImmutable;

/**
 * One row of SET-06. Never an IP address or a place (02_PRODUCT_SPEC §3.1). The id is opaque: "t<token id>" for an app, "w<keyed hash>"
 * for a browser, never the session id itself, which is the cookie.
 */
final readonly class DeviceSession
{
    public function __construct(
        public string $id,
        public SessionKind $kind,
        public ?string $deviceName,
        public ?string $platform,
        public ?string $appVersion,
        public CarbonImmutable $lastUsedAt,
        public bool $current,
    ) {}
}
