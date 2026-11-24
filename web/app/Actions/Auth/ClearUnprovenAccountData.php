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
use App\Services\Auth\IdTokens\AppleTokens;

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
    public function __construct(
        private readonly DeleteAllMedia $media,
        private readonly AppleTokens $apple,
    ) {}

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
            // M5.9d: an invite code set by whoever typed the address is not the owner's.
            'pending_invite_code' => null,
        ])->save();

        // A removed Apple link is revoked at Apple too, after the response (09 §8.1, like at account deletion).
        $links = SocialAccount::query()->where('user_id', $user->id)->get();
        $removed = [
            'passkeys' => MemberPasskey::query()->where('user_id', $user->id)->delete(),
            'providers' => SocialAccount::query()->whereKey($links->modelKeys())->delete(),
            'passkey_ceremonies' => PasskeyChallenge::query()->where('user_id', $user->id)->delete(),
            'open_codes' => LoginAttempt::query()->where('user_id', $user->id)->whereNull('consumed_at')->delete(),
        ];

        Audit::record(MemberSecurityEvent::UnprovenDataCleared->value, $user, after: $removed, actor: $user);

        $this->apple->revokeLater($user, $links);
    }
}
