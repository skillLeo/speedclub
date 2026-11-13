<?php

namespace App\Support\Auth;

use App\Enums\SessionKind;
use Carbon\CarbonImmutable;

/**
 * One row of SET-06. Never an IP address. A place only as the approximate city of 09 §8.4 (a GeoLite2 database, OA-33; none until then).
 * The id is opaque: "t<token id>" for an app, "w<keyed hash>" for a browser, never the session id itself, which is the cookie.
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
        public ?string $osVersion = null,
        public ?string $approxCity = null,
        public ?CarbonImmutable $signedInAt = null,
    ) {}
}
