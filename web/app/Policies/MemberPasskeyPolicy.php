<?php

namespace App\Policies;

use App\Models\MemberPasskey;
use App\Models\User;
use Illuminate\Auth\Access\Response;

/**
 * A passkey belongs to one member; for anybody else it does not exist (404, not 403, so ids reveal nothing).
 */
class MemberPasskeyPolicy
{
    public function update(User $user, MemberPasskey $passkey): Response
    {
        return $this->own($user, $passkey);
    }

    public function delete(User $user, MemberPasskey $passkey): Response
    {
        return $this->own($user, $passkey);
    }

    private function own(User $user, MemberPasskey $passkey): Response
    {
        return $passkey->user_id === $user->id && ! $user->isDeactivated() ? Response::allow() : Response::denyAsNotFound();
    }
}
