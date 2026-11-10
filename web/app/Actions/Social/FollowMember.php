<?php

namespace App\Actions\Social;

use App\Models\Follow;
use App\Models\User;
use App\Services\Notifications\Notifier;
use Throwable;

/**
 * No approval (02_PRODUCT_SPEC §3.5). Idempotent through the unique pair: following twice stays one row, also under a race. Only a new
 * row tells the member (new_follower, grouped per day).
 */
class FollowMember
{
    public function __construct(private readonly Notifier $notifier) {}

    public function handle(User $follower, User $member): void
    {
        $inserted = Follow::query()->insertOrIgnore([
            'follower_id' => $follower->id,
            'followee_id' => $member->id,
            'created_at' => now(),
        ]);

        if ($inserted === 1) {
            // The follow stands whatever happens to its notification (M2.2 review #10).
            try {
                $this->notifier->newFollower($member, $follower);
            } catch (Throwable $exception) {
                report($exception);
            }
        }
    }
}
