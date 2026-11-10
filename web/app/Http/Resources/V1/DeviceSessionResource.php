<?php

namespace App\Http\Resources\V1;

use App\Enums\SessionKind;
use App\Support\Auth\DeviceSession;
use Illuminate\Http\Request;
use Illuminate\Http\Resources\Json\JsonResource;

/**
 * SET-06 row. No IP address and no place (02_PRODUCT_SPEC §3.1).
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
        ];
    }
}
