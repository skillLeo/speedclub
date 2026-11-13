<?php

namespace App\Http\Resources\V1;

use App\Models\Follow;
use App\Models\User;
use App\Services\Auth\MemberStats;
use App\Services\Showcase\SampleContent;
use App\Support\Viewer;
use Illuminate\Http\Request;
use Illuminate\Http\Resources\Json\JsonResource;

/**
 * The answer to follow and unfollow: the state, and the real count for the button's neighbour on FS-8.
 *
 * neutral() is for unfollowing a name the viewer may not see, or that nobody has. It holds nothing but the name as requested,
 * so it cannot tell whether a member stands behind it, nor undo a rename across a block.
 *
 * @mixin User
 *
 * @property User|null $resource
 */
class FollowStateResource extends JsonResource
{
    private string $requestedName = '';

    public static function neutral(string $username): self
    {
        $state = new self(null);
        $state->requestedName = $username;

        return $state;
    }

    /**
     * @return array<string, mixed>
     */
    public function toArray(Request $request): array
    {
        $viewer = Viewer::from($request);
        $member = $this->resource;

        return [
            /** @var string */
            'username' => $member === null ? $this->requestedName : $member->username,
            'is_following' => $member !== null && $viewer !== null && Follow::query()->where('follower_id', $viewer->id)->where('followee_id', $member->id)->exists(),
            /**
             * Null after unfollowing somebody you cannot see, and for a sample member (09 §8.19).
             *
             * @var int|null
             */
            'followers' => $member === null ? null : SampleContent::count($member, app(MemberStats::class)->followers($member)),
        ];
    }
}
