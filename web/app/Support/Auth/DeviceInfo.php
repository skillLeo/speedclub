<?php

namespace App\Support\Auth;

use App\Enums\DevicePlatform;

/**
 * What a native client says about itself at sign-in. Its presence selects token auth (05_ARCHITECTURE §7).
 *
 * $id is the per-install id the app keeps in its secure storage. With it, a device is that install; without it (older app
 * builds), a device is its name and platform, so two phones of the same model count as one.
 */
final readonly class DeviceInfo
{
    /**
     * What device_id may be: a UUID or anything as plain, so it cannot carry more than an id.
     */
    public const ID_PATTERN = '/^[A-Za-z0-9-]{8,64}$/';

    /** ID_PATTERN without delimiters and anchors, for route constraints (`Route::where`). */
    public const ROUTE_PATTERN = '[A-Za-z0-9-]{8,64}';

    public function __construct(
        public string $name,
        public ?DevicePlatform $platform = null,
        public ?string $appVersion = null,
        public ?string $id = null,
    ) {}

    /**
     * For the new-device notice (KnownDevices). With an id, a second phone of the same model is a new device too.
     */
    public function fingerprint(): string
    {
        if ($this->id !== null) {
            return hash('sha256', 'token-id|'.mb_strtolower($this->id));
        }

        return hash('sha256', 'token|'.mb_strtolower($this->name).'|'.($this->platform->value ?? ''));
    }
}
