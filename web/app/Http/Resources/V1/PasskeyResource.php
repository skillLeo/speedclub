<?php

namespace App\Http\Resources\V1;

use App\Models\MemberPasskey;
use App\Services\Auth\Passkeys\PasskeyProviders;
use Illuminate\Http\Request;
use Illuminate\Http\Resources\Json\JsonResource;

/**
 * One of the member's passkeys (SET security, 09 §8.2). Never the key or its credential id.
 *
 * @property MemberPasskey $resource
 */
class PasskeyResource extends JsonResource
{
    /**
     * @return array<string, mixed>
     */
    public function toArray(Request $request): array
    {
        $provider = PasskeyProviders::for($this->resource->aaguid, app()->getLocale());

        return [
            'id' => $this->resource->id,
            'name' => $this->resource->name,
            /** @var string|null The password manager or platform, from the AAGUID ("iCloud-Schlüsselbund", "Google Passwortmanager"). */
            'provider' => $provider['name'],
            /** Icon key for the app: apple, google, chrome, 1password, bitwarden, samsung, windows, microsoft, dashlane, proton or key. */
            'provider_icon' => $provider['icon'],
            /** Synced across the member's devices (backup state of the credential). */
            'synced' => $this->resource->getAttribute('backed_up') === true,
            /** @var string|null */
            'last_used_at' => $this->resource->getAttribute('last_used_at')?->toIso8601String(),
            /** @var string */
            'created_at' => $this->resource->created_at?->toIso8601String(),
        ];
    }
}
