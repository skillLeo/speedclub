<?php

namespace App\Http\Resources\V1;

use App\Services\Discover\MemberHit;
use App\Services\Showcase\SampleContent;
use App\Services\Social\MessagingEligibility;
use App\Support\Viewer;
use Illuminate\Http\Request;
use Illuminate\Http\Resources\Json\JsonResource;

/**
 * A member row of DISC-02: avatar, @username, display name, city and the garage summary "3 Fahrzeuge · BMW, Nissan"
 * (02_PRODUCT_SPEC §3.7). Public profile data only; the profile itself is `public/users/{username}`.
 *
 * @property MemberHit $resource
 */
class MemberSearchResource extends JsonResource
{
    /**
     * @return array<string, mixed>
     */
    public function toArray(Request $request): array
    {
        $hit = $this->resource;
        $locale = app()->getLocale();
        $count = trans_choice('discover.garage_count', $hit->vehicleCount, ['count' => $hit->vehicleCount], $locale);
        $viewer = Viewer::from($request);
        // Search leaves out blocks either way, so only the setting and the two accounts decide.
        $reason = $viewer === null ? null : app(MessagingEligibility::class)->reason($viewer, $hit->member, blocked: false);

        return [
            ...(new MemberSummaryResource($hit->member))->toArray($request),
            /**
             * Public builds as the profile lists them, and their makes, main vehicle first, at most three. For a sample member the count is
             * null and the line names the makes only (09 §8.19: counts on samples are hidden).
             *
             * @var array{vehicles: int|null, makes: list<string>, line: string}
             */
            'garage' => [
                'vehicles' => SampleContent::count($hit->member, $hit->vehicleCount),
                'makes' => $hit->makes,
                /** "3 Fahrzeuge · BMW, Nissan" */
                'line' => match (true) {
                    SampleContent::isSample($hit->member) => implode(', ', $hit->makes),
                    $hit->makes === [] => $count,
                    default => $count.' · '.implode(', ', $hit->makes),
                },
            ],
            'is_self' => $viewer?->is($hit->member) ?? false,
            /** The signed-in viewer follows this member (DQ-326, "Folgen" on the row); false for guests and for the viewer's own row. */
            'is_following' => $viewer !== null && ! $viewer->is($hit->member) && $hit->isFollowing,
            /** MSG-03 (M2.4): you may write to this member now; false for guests. */
            'can_message' => $reason === null && $viewer !== null,
            /**
             * Why not, for a signed-in viewer: recipient_closed, not_verified, restricted. Null for guests and when you may write.
             */
            'cannot_message_reason' => $viewer === null ? null : $reason,
        ];
    }
}
