<?php

namespace App\Http\Resources\V1;

use App\Models\InviteCode;
use App\Models\User;
use Illuminate\Http\Request;
use Illuminate\Http\Resources\Json\JsonResource;

/**
 * GET invites/{code} (m5.9d contract §10.4): an open code and who invites ("Du wurdest von @… eingeladen"), for the sign-up screens.
 *
 * @property InviteCode $resource
 */
class InviteLookupResource extends JsonResource
{
    /**
     * @return array<string, mixed>
     */
    public function toArray(Request $request): array
    {
        $inviter = $this->resource->inviter;

        return [
            'code' => $this->resource->code,
            /** @var array{username: string, display_name: string|null}|null */
            'inviter' => $inviter instanceof User && $inviter->username !== null
                ? ['username' => $inviter->username, 'display_name' => $inviter->getAttribute('display_name')]
                : null,
        ];
    }
}
