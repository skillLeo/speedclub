<?php

namespace App\Actions\Social;

use App\Actions\Messaging\CloseConversationsOfPair;
use App\Models\Block;
use App\Models\Follow;
use App\Models\User;
use Illuminate\Support\Facades\DB;

/**
 * A block hides both members from each other everywhere, ends follows in both directions and prevents new ones and messages
 * (02_PRODUCT_SPEC §3.5), and closes the pair's conversation for both (M2.4). Idempotent through the unique pair: blocking twice stays one row and keeps the first date and the first
 * name (an upsert that updates nothing on a duplicate; unlike insertOrIgnore it still fails on a missing member).
 *
 * blocked_username is the name as the blocker sent it, lowercased: SET-08 shows that, never the member's live profile (ADR-189 d, as
 * amended by the M2.1 review).
 *
 * Saves stay: a saved build of the other member drops out of PROF-05 while the block holds and comes back after it, as the list
 * reads the visibility live (App\Http\Controllers\Api\V1\Social\SaveController).
 */
class BlockMember
{
    public function __construct(private readonly CloseConversationsOfPair $conversations) {}

    public function handle(User $blocker, User $member, ?string $asSent = null): void
    {
        $name = mb_strtolower(trim($asSent ?? (string) $member->username));

        DB::transaction(function () use ($blocker, $member, $name): void {
            Block::query()->upsert(
                [['blocker_id' => $blocker->id, 'blocked_id' => $member->id, 'blocked_username' => mb_substr($name, 0, 64), 'created_at' => now()]],
                ['blocker_id', 'blocked_id'],
                ['blocker_id'],
            );

            Follow::query()
                ->where(fn ($query) => $query->where('follower_id', $blocker->id)->where('followee_id', $member->id))
                ->orWhere(fn ($query) => $query->where('follower_id', $member->id)->where('followee_id', $blocker->id))
                ->delete();

            // M2.4: the pair's conversation closes for both (m2.4-contract §1).
            $this->conversations->handle($blocker, $member);
        });
    }
}
