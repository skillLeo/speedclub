<?php

namespace App\Services\Social;

use App\Models\BuildUpdate;
use App\Models\Comment;
use App\Models\User;
use App\Services\Notifications\Notifier;
use Illuminate\Support\Facades\DB;
use Throwable;

/**
 * Mentions of a build update or a comment, and their notification after the commit: only members mentioned for the first time, and only
 * those who can open the update (a followers-only update reaches followers only, BuildUpdate::reaches).
 */
final class BuildUpdateMentions
{
    public function __construct(
        private readonly Mentions $mentions,
        private readonly Notifier $notifier,
    ) {}

    public function afterSave(BuildUpdate $update, User $author, ?string $text, ?Comment $comment = null): void
    {
        $new = $this->mentions->sync($comment ?? $update, $author, $text);

        if ($new === []) {
            return;
        }

        DB::afterCommit(function () use ($new, $update, $author, $comment): void {
            foreach ($new as $member) {
                try {
                    if ($update->reaches($member)) {
                        $this->notifier->mention($member, $author, $update->vehicle, $update, $comment);
                    }
                } catch (Throwable $exception) {
                    // The post stands whatever happens to a notification (M2.2 review #10).
                    report($exception);
                }
            }
        });
    }
}
