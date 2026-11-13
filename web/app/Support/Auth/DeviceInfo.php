<?php

namespace App\Support\Auth;

use App\Enums\DevicePlatform;
use App\Models\User;
use App\Services\Auth\DeviceInstalls;

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
        // M4.7 (09 §8.4): "Android 16", "iOS 26.1"; shown in SET-06.
        public ?string $osVersion = null,
        // SEC-M47-03: set by keyedFor(), the install without the member (DeviceInstalls::installKey).
        public ?string $installKey = null,
    ) {}

    /**
     * The same device with its install id in the stored form (DeviceInstalls::key), which is all the server keeps. Applied once, when the
     * member is known (SignInMember::handle); a device without an id stays as it is.
     */
    public function keyedFor(User $user): self
    {
        if ($this->id === null || $this->installKey !== null) {
            return $this;
        }

        return new self($this->name, $this->platform, $this->appVersion, DeviceInstalls::key((string) $user->getKey(), $this->id), $this->osVersion, DeviceInstalls::installKey($this->id));
    }

    /**
     * For the new-device notice (KnownDevices). With an id, a second phone of the same model is a new device too. Computed from the keyed
     * id once keyedFor() ran, so known_devices holds nothing two accounts share.
     */
    public function fingerprint(): string
    {
        if ($this->id !== null) {
            return hash('sha256', 'token-id|'.mb_strtolower($this->id));
        }

        return hash('sha256', 'token|'.mb_strtolower($this->name).'|'.($this->platform->value ?? ''));
    }
}
