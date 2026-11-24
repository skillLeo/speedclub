<?php

namespace App\Http\Resources\V1;

use App\Models\InviteCode;
use App\Models\User;
use Illuminate\Http\Request;
use Illuminate\Http\Resources\Json\JsonResource;

/**
 * One of the member's invite codes (m5.9d contract §5, §10.4). accepted_by names the member who redeemed it while the inviter may see
 * them (a username, publicly visible, no block); a redeemed code may still come without a name.
 *
 * @property InviteCode $resource
 */
class InviteResource extends JsonResource
{
    /**
     * @return array<string, mixed>
     */
    public function toArray(Request $request): array
    {
        $invite = $this->resource;
        $inviter = $request->user();
        $invitee = $invite->relationLoaded('invitee') ? $invite->getRelation('invitee') : null;
        $shown = $invitee instanceof User && $inviter instanceof User && $invitee->hasUsername() && $invitee->isPubliclyVisible() && ! $inviter->hasBlockWith($invitee);

        return [
            /** 8 characters Crockford; the link is https://<host>/join/{code}. */
            'code' => $invite->code,
            /** @var string|null */
            'created_at' => $invite->created_at?->toIso8601String(),
            /** @var string|null When somebody activated an account with it; null while open. */
            'accepted_at' => $invite->accepted_at?->toIso8601String(),
            /** @var array{username: string, display_name: string|null}|null */
            'accepted_by' => $shown ? ['username' => (string) $invitee->username, 'display_name' => $invitee->getAttribute('display_name')] : null,
        ];
    }
}
