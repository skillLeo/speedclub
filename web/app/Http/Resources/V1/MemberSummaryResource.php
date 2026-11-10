<?php

namespace App\Http\Resources\V1;

use App\Enums\MediaStatus;
use App\Enums\ModerationStatus;
use App\Models\Media;
use App\Models\User;
use Illuminate\Http\Request;
use Illuminate\Http\Resources\Json\JsonResource;

/**
 * The owner row of a card and the featured overlay (FS-2 "@lukas.sc · Stuttgart"): public profile data only, no counts.
 *
 * @property User $resource
 */
class MemberSummaryResource extends JsonResource
{
    /**
     * @return array<string, mixed>
     */
    public function toArray(Request $request): array
    {
        $member = $this->resource;
        $avatar = $member->avatar;
        $visible = $avatar instanceof Media && $avatar->status === MediaStatus::Ready && $avatar->moderation_status !== ModerationStatus::Rejected;

        return [
            /** @var string */
            'username' => $member->username,
            /** @var string|null */
            'display_name' => $member->getAttribute('display_name'),
            /** @var string|null */
            'city' => $member->getAttribute('city'),
            'avatar' => $visible ? new MediaResource($avatar) : null,
        ];
    }
}
