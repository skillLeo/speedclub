<?php

namespace App\Http\Resources\V1;

use App\Enums\MediaStatus;
use App\Enums\ModerationStatus;
use App\Models\Media;
use App\Models\User;
use App\Services\Auth\MemberStats;
use App\Services\Showcase\SampleContent;
use Illuminate\Http\Request;
use Illuminate\Http\Resources\Json\JsonResource;

/**
 * What others see of a member (PROF-02, WEB-02, M1.7). No address, settings or state: only public profile data.
 *
 * @property User $resource
 */
class MemberPublicResource extends JsonResource
{
    /**
     * @return array<string, mixed>
     */
    public function toArray(Request $request): array
    {
        $member = $this->resource;
        $avatar = $this->visible($member->avatar);
        $cover = $this->visible($member->cover);

        return [
            'username' => $member->username,
            /** @var string|null */
            'display_name' => $member->getAttribute('display_name'),
            /** @var string|null */
            'city' => $member->getAttribute('city'),
            /** @var string|null */
            'bio' => $member->getAttribute('bio'),
            /** @var MediaResource|null */
            'avatar' => $avatar === null ? null : new MediaResource($avatar),
            /** @var MediaResource|null */
            'cover' => $cover === null ? null : new MediaResource($cover),
            /** @var string */
            'member_since' => $member->created_at?->toIso8601String(),
            /**
             * Each count is null for a sample member (09 §8.19: counts on samples are hidden).
             */
            'stats' => SampleContent::stats($member, app(MemberStats::class)->for($member, asOwner: false)),
            /** Sample content (09 §8.19): the "Beispiel" badge. */
            'is_sample' => $member->getAttribute('is_sample') === true,
            /** The SPEED CLUB Editorial account: the "Editorial" badge. */
            'is_editorial' => $member->getAttribute('is_editorial') === true,
        ];
    }

    private function visible(?Media $media): ?Media
    {
        return $media !== null && $media->status === MediaStatus::Ready && $media->moderation_status !== ModerationStatus::Rejected
            ? $media
            : null;
    }
}
