<?php

namespace App\Http\Resources\V1;

use App\Enums\MediaStatus;
use App\Enums\ModerationStatus;
use App\Models\Media;
use App\Models\User;
use Illuminate\Http\Request;
use Illuminate\Http\Resources\Json\JsonResource;

/**
 * The owner row of a card and the featured overlay (FS-2 "@lukas.sc · Stuttgart"): public profile data only, no counts. is_sample and
 * is_editorial carry the "Beispiel" and "Editorial" badges (09 §8.19).
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
            /** Sample content (09 §8.19): the app shows the "Beispiel" badge. */
            'is_sample' => $member->getAttribute('is_sample') === true,
            /** The SPEED CLUB Editorial account, owner of the sample builds: the app shows the "Editorial" badge. */
            'is_editorial' => $member->getAttribute('is_editorial') === true,
        ];
    }
}
