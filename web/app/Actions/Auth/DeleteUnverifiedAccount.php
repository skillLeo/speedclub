<?php

namespace App\Actions\Auth;

use App\Models\Media;
use App\Models\User;
use App\Services\Auth\MemberSessions;
use App\Services\Crews\CrewAccountDeletion;
use App\Services\Media\MediaService;
use Illuminate\Support\Facades\DB;

/**
 * Removes an account whose address was never proven (ADR-135): it blocks the address for the real owner and holds only
 * what a stranger may have typed. Tokens and sessions have no foreign key, and the media rows would cascade without their
 * files, so all three go first.
 *
 * R4DQ-21: the account's crew memberships would cascade without their crew, so a crew it founded kept its count and no founder. As
 * DeleteAccount (C8), the crews are handed over or ended and recounted first (an address may lose its proof after an e-mail change).
 */
class DeleteUnverifiedAccount
{
    public function __construct(
        private readonly MemberSessions $sessions,
        private readonly MediaService $media,
    ) {}

    public function handle(User $user): void
    {
        DB::transaction(fn () => app(CrewAccountDeletion::class)->accountClosed($user));

        $this->sessions->revokeAll($user);

        foreach (Media::withTrashed()->where('owner_id', $user->getKey())->get() as $item) {
            $this->media->purge($item);
        }

        $user->forceDelete();
    }
}
