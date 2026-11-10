<?php

namespace App\Http\Resources\V1;

use App\Models\Follow;
use App\Models\User;
use App\Services\Social\MessagingEligibility;
use App\Support\Viewer;
use Illuminate\Http\Request;

/**
 * The public member plus how the viewer stands to them, for FS-3's owner row and FS-8. A client that asked for another username
 * than `username` answers came through an old name, and redirects to this one.
 *
 * @property User $resource
 */
class MemberProfileResource extends MemberPublicResource
{
    /**
     * @return array<string, mixed>
     */
    public function toArray(Request $request): array
    {
        $viewer = Viewer::from($request);
        $member = $this->resource;
        $isSelf = $viewer !== null && $viewer->is($member);
        [$following, $followsYou] = $viewer === null || $isSelf ? [false, false] : $this->follows($viewer, $member);

        return [
            ...parent::toArray($request),
            'is_self' => $isSelf,
            'is_following' => $following,
            /** The member follows the viewer. False for guests and on your own profile. */
            'follows_you' => $followsYou,
            /**
             * The viewer may start a conversation now (Nachricht). False for guests, on your own profile, while unverified or restricted
             * from messaging, and when the member's `who_can_message` does not allow it.
             *
             * @var bool
             */
            'can_message' => app(MessagingEligibility::class)->canMessage($viewer, $member, $followsYou),
        ];
    }

    /**
     * Both directions in one query (M2.1 review #10).
     *
     * @return array{0: bool, 1: bool} [the viewer follows the member, the member follows the viewer]
     */
    private function follows(User $viewer, User $member): array
    {
        $rows = Follow::query()
            ->where(fn ($query) => $query->where('follower_id', $viewer->id)->where('followee_id', $member->id))
            ->orWhere(fn ($query) => $query->where('follower_id', $member->id)->where('followee_id', $viewer->id))
            ->pluck('follower_id')
            ->map(strval(...))
            ->all();

        return [in_array($viewer->id, $rows, true), in_array($member->id, $rows, true)];
    }
}
