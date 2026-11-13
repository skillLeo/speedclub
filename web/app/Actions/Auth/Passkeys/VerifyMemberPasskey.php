<?php

namespace App\Actions\Auth\Passkeys;

use App\Enums\MemberSecurityEvent;
use App\Enums\PasskeyCeremony;
use App\Enums\SecurityNotice;
use App\Models\MemberPasskey;
use App\Models\User;
use App\Services\Audit\Audit;
use App\Services\Auth\Passkeys\MemberWebAuthn;
use App\Services\Auth\Passkeys\PasskeyCounterRegressed;
use App\Services\Notifications\Notifier;
use Illuminate\Support\Facades\DB;

/**
 * An assertion (sign-in or re-authentication) checked against the stored passkey, then its counter, backup state and last use saved.
 * A signature counter that did not grow is refused (422 passkey_invalid) and reported: audit event and security mail (09 §8.2).
 */
class VerifyMemberPasskey
{
    public function __construct(
        private readonly MemberWebAuthn $webauthn,
        private readonly Notifier $notifier,
    ) {}

    /**
     * @param  array<string, mixed>  $credential
     */
    public function handle(PasskeyCeremony $ceremony, string $ceremonyId, array $credential, ?User $user = null): MemberPasskey
    {
        try {
            ['passkey' => $passkey, 'record' => $record] = $this->webauthn->finishAssertion($ceremony, $ceremonyId, $credential, $user);
        } catch (PasskeyCounterRegressed $regressed) {
            $owner = $regressed->passkey->user;

            if ($owner !== null) {
                Audit::record(MemberSecurityEvent::PasskeySignCountRegressed->value, $owner, after: ['passkey_id' => $regressed->passkey->id], actor: $owner);
                $this->notifier->security($owner, SecurityNotice::PasskeyRejected, $regressed->passkey->name);
            }

            throw MemberWebAuthn::invalid();
        }

        return DB::transaction(function () use ($passkey, $record): MemberPasskey {
            $fresh = MemberPasskey::query()->whereKey($passkey->id)->lockForUpdate()->firstOrFail();

            // A parallel assertion with the same counter lost the race.
            if ($record->counter !== 0 && $record->counter <= $fresh->sign_count) {
                throw MemberWebAuthn::invalid();
            }

            $fresh->forceFill([
                'credential' => $this->webauthn->recordToArray($record),
                'sign_count' => $record->counter,
                'backed_up' => $record->backupStatus === true,
                'last_used_at' => now(),
            ])->save();

            return $fresh;
        });
    }
}
