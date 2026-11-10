<?php

namespace App\Actions\Auth;

use App\Actions\Media\DeleteAllMedia;
use App\Models\User;

/**
 * For the moment a password reset proves the address of an account nobody had verified yet. Whatever was set before that
 * came from someone who only had to type the address (ADR-135), so it does not bind the real owner: a marketing consent
 * in particular is not one of theirs, and the username counts as never chosen.
 */
class ClearUnprovenAccountData
{
    public function __construct(private readonly DeleteAllMedia $media) {}

    public function handle(User $user): void
    {
        $this->media->forMember($user);

        $user->forceFill([
            'marketing_consent_at' => null,
            'username' => null,
            'previous_username' => null,
            'username_changed_at' => null,
            'display_name' => null,
            'city' => null,
            'bio' => null,
            'profile_setup_at' => null,
            'avatar_media_id' => null,
            'cover_media_id' => null,
        ])->save();
    }
}
