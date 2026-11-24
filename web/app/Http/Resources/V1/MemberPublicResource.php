<?php

namespace App\Http\Resources\V1;

use App\Enums\MediaStatus;
use App\Enums\ModerationStatus;
use App\Enums\ViewSource;
use App\Models\Media;
use App\Models\User;
use App\Services\Auth\MemberStats;
use App\Services\Garage\MemberCovers;
use App\Services\Progress\Levels;
use App\Services\Showcase\SampleContent;
use App\Support\PublicUrl;
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
        // SEC-414-10: a cover from a vehicle that left the public garage is not shown (MemberCovers, as on /u and its og:image).
        $reader = $request->user();
        $cover = MemberCovers::visible($member, $reader instanceof User ? $reader : null);

        return [
            'username' => $member->username,
            /**
             * M5.7: the profile address for the share sheet, `/u/{username}?via=share` (a view through it counts as "geteilter Link" in the
             * member's statistics); null without a username.
             */
            'share_url' => $member->username === null ? null : PublicUrl::absolute('/u/'.$member->username.'?via='.ViewSource::SHARE_PARAMETER),
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
            /** The Speedclub Editorial account: the "Editorial" badge. */
            'is_editorial' => $member->getAttribute('is_editorial') === true,
            /** M5.9d: the quiet level next to the name ("Lvl 4 · Parts Hunter"). */
            'level' => new LevelSummaryResource(app(Levels::class)->summary((int) $member->getAttribute('xp'))),
            /** @var int|null M5.9d: "Founding Member #0042" (1–1000); null for everybody else. */
            'founding_number' => $member->getAttribute('founding_number'),
        ];
    }

    private function visible(?Media $media): ?Media
    {
        return $media !== null && $media->status === MediaStatus::Ready && $media->moderation_status !== ModerationStatus::Rejected
            ? $media
            : null;
    }
}
