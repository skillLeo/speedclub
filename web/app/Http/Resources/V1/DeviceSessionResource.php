<?php

namespace App\Http\Resources\V1;

use App\Enums\SessionKind;
use App\Support\Auth\DeviceSession;
use Illuminate\Http\Request;
use Illuminate\Http\Resources\Json\JsonResource;

/**
 * SET-06 row (09 §7.9, §8.4). No IP address; a place only as an approximate city when a GeoLite2 database is set up (OA-33).
 *
 * @property DeviceSession $resource
 */
class DeviceSessionResource extends JsonResource
{
    /**
     * @return array<string, mixed>
     */
    public function toArray(Request $request): array
    {
        return [
            /** Opaque: "t…" for an app sign-in, "w…" for a browser. Send it to DELETE me/sessions/{id}. */
            'id' => $this->resource->id,
            /** @var SessionKind */
            'kind' => $this->resource->kind,
            /** @var string|null What the device calls itself ("iPhone 15 Pro"), or browser and system ("Chrome auf macOS"). */
            'device_name' => $this->resource->deviceName,
            /** @var string|null ios, android or web. */
            'platform' => $this->resource->platform,
            /** @var string|null */
            'app_version' => $this->resource->appVersion,
            /** ISO 8601. */
            'last_used_at' => $this->resource->lastUsedAt->toIso8601String(),
            /** The device of this request. */
            'current' => $this->resource->current,
            /** @var string|null The system version the app last reported ("16" on Android, "26.1" on iOS); null for a browser. */
            'os_version' => $this->resource->osVersion,
            /** @var string|null "München": approximate, only with a GeoLite2 database (owner action OA-33); null until then. */
            'approx_city' => $this->resource->approxCity,
            /** @var string|null ISO 8601. When this install first signed in; null for a browser. */
            'signed_in_at' => $this->resource->signedInAt?->toIso8601String(),
        ];
    }
}
