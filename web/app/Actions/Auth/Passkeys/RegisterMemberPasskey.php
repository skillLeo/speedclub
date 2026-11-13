<?php

namespace App\Actions\Auth\Passkeys;

use App\Enums\ErrorCode;
use App\Enums\MemberSecurityEvent;
use App\Enums\SecurityNotice;
use App\Exceptions\ApiException;
use App\Models\MemberPasskey;
use App\Models\User;
use App\Services\Audit\Audit;
use App\Services\Auth\Passkeys\MemberWebAuthn;
use App\Services\Auth\Passkeys\PasskeyProviders;
use App\Services\Notifications\Notifier;
use App\Services\Security\LoginAlerts;
use App\Support\Security\SecurityAlert;
use Illuminate\Database\UniqueConstraintViolationException;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Str;
use ParagonIE\ConstantTime\Base64UrlSafe;

/**
 * POST me/passkeys (09 §8.2, recent auth): the attestation of the ceremony from POST me/passkeys/options, stored with its AAGUID,
 * transports and backup flags. Without a name the provider's ("iCloud-Schlüsselbund") or "Passkey". At most 20 per member. Audit event,
 * security mail and in-app row.
 */
class RegisterMemberPasskey
{
    public function __construct(
        private readonly MemberWebAuthn $webauthn,
        private readonly Notifier $notifier,
    ) {}

    /**
     * @param  array<string, mixed>  $credential
     */
    public function handle(User $user, string $ceremonyId, array $credential, ?string $name): MemberPasskey
    {
        // SEC-M46-01, also behind the route's verified-member: an unproved address may be a stranger's pre-registration.
        if (! $user->hasVerifiedEmail()) {
            throw new ApiException(ErrorCode::EmailNotVerified);
        }

        if ($user->memberPasskeys()->count() >= config()->integer('speedclub.passkeys.max_per_member')) {
            throw new ApiException(ErrorCode::Conflict);
        }

        ['record' => $record, 'response' => $response] = $this->webauthn->finishRegistration($user, $ceremonyId, $credential);

        $aaguid = $record->aaguid->toRfc4122();
        $authData = $response->attestationObject->authData;
        $label = $name !== null && trim($name) !== ''
            ? Str::limit(trim($name), config()->integer('speedclub.passkeys.name_max_length'), '')
            : (PasskeyProviders::for($aaguid, (string) $user->getAttribute('locale'))['name'] ?? 'Passkey');

        try {
            $passkey = DB::transaction(function () use ($user, $record, $response, $aaguid, $authData, $label): MemberPasskey {
                $passkey = new MemberPasskey;
                $passkey->forceFill([
                    'user_id' => $user->id,
                    'name' => $label,
                    'credential_id' => Base64UrlSafe::encodeUnpadded($record->publicKeyCredentialId),
                    'credential' => $this->webauthn->recordToArray($record),
                    'aaguid' => $aaguid,
                    'transports' => array_values(array_filter($response->transports, is_string(...))),
                    'backup_eligible' => $authData->isBackupEligible() === true,
                    'backed_up' => $authData->isBackedUp() === true,
                    'sign_count' => $record->counter,
                ])->save();

                Audit::record(MemberSecurityEvent::PasskeyAdded->value, $user, after: ['passkey_id' => $passkey->id, 'aaguid' => $aaguid], actor: $user);

                return $passkey;
            });
        } catch (UniqueConstraintViolationException) {
            throw MemberWebAuthn::invalid();
        }

        // M4.7 (09 §8.4): a new way in is a login alert too, with "Das war ich nicht".
        $this->notifier->security($user, SecurityNotice::PasskeyAdded, $label, alert: new SecurityAlert(secureUrl: app(LoginAlerts::class)->secureUrlFor($user, MemberSecurityEvent::PasskeyAdded)));

        return $passkey;
    }
}
