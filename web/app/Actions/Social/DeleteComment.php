<?php

namespace App\Actions\Social;

use App\Models\Comment;
use App\Services\Social\Mentions;
use Illuminate\Support\Facades\DB;

/**
 * Deleted by its author or the update's owner (soft delete); a top-level comment takes its replies along. Reports keep their snapshot.
 */
class DeleteComment
{
    public function handle(Comment $comment): void
    {
        DB::transaction(function () use ($comment): void {
            foreach ([$comment, ...$comment->replies()->get()->all()] as $gone) {
                Mentions::forget($gone);
                $gone->delete();
            }
        });
    }
}
