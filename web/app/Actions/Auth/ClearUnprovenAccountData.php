<?php

namespace App\Actions\Auth;

use App\Actions\Media\DeleteAllMedia;
use App\Enums\MemberSecurityEvent;
use App\Models\LoginAttempt;
use App\Models\MemberPasskey;
use App\Models\PasskeyChallenge;
use App\Models\SocialAccount;
use App\Models\User;
use App\Services\Audit\Audit;

/**
 * For the moment a password reset proves the address of an account nobody had verified yet. Whatever was set before that
 * came from someone who only had to type the address (ADR-135), so it does not bind the real owner: a marketing consent
 * in particular is not one of theirs, and the username counts as never chosen.
 *
 * SEC-M46-01: the same holds for ways in. Passkeys, linked providers, open passkey ceremonies and open e-mail codes of the unproved
 * account go, so a stranger who pre-registered the address cannot sign in with his own passkey or Google account once the owner has
 * proved it. Callers run this before they link the provider that is the proof (SignInWithProvider), and an e-mail code is spent before.
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

        $removed = [
            'passkeys' => MemberPasskey::query()->where('user_id', $user->id)->delete(),
            'providers' => SocialAccount::query()->where('user_id', $user->id)->delete(),
            'passkey_ceremonies' => PasskeyChallenge::query()->where('user_id', $user->id)->delete(),
            'open_codes' => LoginAttempt::query()->where('user_id', $user->id)->whereNull('consumed_at')->delete(),
        ];

        Audit::record(MemberSecurityEvent::UnprovenDataCleared->value, $user, after: $removed, actor: $user);
    }
}
