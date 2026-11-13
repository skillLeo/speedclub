<?php

namespace App\Services\Auth;

use App\Models\MemberPasskey;
use App\Models\SocialAccount;
use App\Models\User;

/**
 * The ways into an account (09 §8.1 "unlinking only if another method remains"): the password, each passkey, each linked provider, and
 * the e-mail code to the account's address. An Apple private relay address counts as no address here: mail to it only arrives once the
 * sending domain is registered with Apple (owner action OA-34), so it must not be the last way in.
 */
final class SignInMethods
{
    public function remainWithout(User $user, SocialAccount|MemberPasskey $leaving): bool
    {
        if ($user->hasPassword() || $this->mailboxReachable($user)) {
            return true;
        }

        $passkeys = $user->memberPasskeys()->when($leaving instanceof MemberPasskey, fn ($query) => $query->whereKeyNot($leaving->getKey()))->count();
        $providers = $user->socialAccounts()->when($leaving instanceof SocialAccount, fn ($query) => $query->whereKeyNot($leaving->getKey()))->count();

        return $passkeys + $providers > 0;
    }

    public function mailboxReachable(User $user): bool
    {
        return ! str_ends_with(mb_strtolower($user->email), '@privaterelay.appleid.com');
    }
}
