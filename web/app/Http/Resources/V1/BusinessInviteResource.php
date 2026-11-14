<?php

namespace App\Http\Resources\V1;

use App\Models\BusinessInvite;
use Illuminate\Http\Request;
use Illuminate\Http\Resources\Json\JsonResource;

/**
 * SEC-414-01: an open team invitation as the invited member reads it: which business (its card: name, kind, city, logo, Verifiziert),
 * who invited (username) and when. The business may not be public yet (an applied business may build its team), so this is all the
 * member learns of it before accepting.
 *
 * @property BusinessInvite $resource
 */
class BusinessInviteResource extends JsonResource
{
    /**
     * @return array<string, mixed>
     */
    public function toArray(Request $request): array
    {
        $invite = $this->resource;

        return [
            'id' => $invite->id,
            'business' => new BusinessCardResource($invite->business),
            /** @var string|null */
            'invited_by' => $invite->inviter?->username,
            'created_at' => $invite->created_at?->toIso8601String(),
        ];
    }
}
