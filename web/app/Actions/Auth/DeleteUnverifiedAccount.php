<?php

namespace App\Actions\Auth;

use App\Models\Media;
use App\Models\User;
use App\Services\Auth\MemberSessions;
use App\Services\Media\MediaService;

/**
 * Removes an account whose address was never proven (ADR-135): it blocks the address for the real owner and holds only
 * what a stranger may have typed. Tokens and sessions have no foreign key, and the media rows would cascade without their
 * files, so all three go first.
 */
class DeleteUnverifiedAccount
{
    public function __construct(
        private readonly MemberSessions $sessions,
        private readonly MediaService $media,
    ) {}

    public function handle(User $user): void
    {
        $this->sessions->revokeAll($user);

        foreach (Media::withTrashed()->where('owner_id', $user->getKey())->get() as $item) {
            $this->media->purge($item);
        }

        $user->forceDelete();
    }
}
