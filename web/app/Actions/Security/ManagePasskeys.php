<?php

namespace App\Actions\Security;

use App\Enums\ErrorCode;
use App\Enums\MemberSecurityEvent;
use App\Enums\SecurityNotice;
use App\Exceptions\ApiException;
use App\Models\MemberPasskey;
use App\Models\User;
use App\Services\Audit\Audit;
use App\Services\Auth\SignInMethods;
use App\Services\Notifications\Notifier;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Str;

/**
 * PATCH and DELETE me/passkeys/{id} (09 §8.2, recent auth). Deleting the last way in is refused (409 last_sign_in_method). The passkey
 * also stays in the member's password manager; the app tells them to remove it there.
 */
class ManagePasskeys
{
    public function __construct(
        private readonly SignInMethods $methods,
        private readonly Notifier $notifier,
    ) {}

    public function rename(User $user, MemberPasskey $passkey, string $name): MemberPasskey
    {
        $name = Str::limit(trim($name), config()->integer('speedclub.passkeys.name_max_length'), '');

        DB::transaction(function () use ($user, $passkey, $name): void {
            $before = $passkey->name;
            $passkey->forceFill(['name' => $name])->save();

            Audit::record(MemberSecurityEvent::PasskeyRenamed->value, $user, before: ['passkey_id' => $passkey->id, 'name' => $before], after: ['passkey_id' => $passkey->id, 'name' => $name], actor: $user);
        });

        return $passkey;
    }

    public function remove(User $user, MemberPasskey $passkey): void
    {
        if (! $this->methods->remainWithout($user, $passkey)) {
            throw new ApiException(ErrorCode::LastSignInMethod);
        }

        DB::transaction(function () use ($user, $passkey): void {
            $passkey->delete();

            Audit::record(MemberSecurityEvent::PasskeyRemoved->value, $user, after: ['passkey_id' => $passkey->id, 'aaguid' => $passkey->aaguid], actor: $user);
        });

        $this->notifier->security($user, SecurityNotice::PasskeyRemoved, $passkey->name);
    }
}
