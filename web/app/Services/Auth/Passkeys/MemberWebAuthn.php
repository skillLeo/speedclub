<?php

namespace App\Services\Auth\Passkeys;

use App\Enums\ErrorCode;
use App\Enums\PasskeyCeremony;
use App\Exceptions\ApiException;
use App\Models\MemberPasskey;
use App\Models\PasskeyChallenge;
use App\Models\User;
use Cose\Algorithms;
use Illuminate\Support\Facades\DB;
use ParagonIE\ConstantTime\Base64UrlSafe;
use Symfony\Component\Serializer\Normalizer\AbstractObjectNormalizer;
use Symfony\Component\Serializer\Normalizer\NormalizerInterface;
use Symfony\Component\Serializer\SerializerInterface;
use Throwable;
use Webauthn\AttestationStatement\AttestationStatementSupportManager;
use Webauthn\AttestationStatement\NoneAttestationStatementSupport;
use Webauthn\AuthenticatorAssertionResponse;
use Webauthn\AuthenticatorAssertionResponseValidator;
use Webauthn\AuthenticatorAttestationResponse;
use Webauthn\AuthenticatorAttestationResponseValidator;
use Webauthn\AuthenticatorSelectionCriteria;
use Webauthn\CeremonyStep\CeremonyStepManagerFactory;
use Webauthn\CredentialRecord;
use Webauthn\Denormalizer\WebauthnSerializerFactory;
use Webauthn\Exception\CounterException;
use Webauthn\PublicKeyCredential;
use Webauthn\PublicKeyCredentialCreationOptions;
use Webauthn\PublicKeyCredentialDescriptor;
use Webauthn\PublicKeyCredentialParameters;
use Webauthn\PublicKeyCredentialRequestOptions;
use Webauthn\PublicKeyCredentialRpEntity;
use Webauthn\PublicKeyCredentialUserEntity;

/**
 * WebAuthn for members on web-auth/webauthn-lib 5.3 directly (ADR-409): laravel/passkeys is pre-1.0, keeps one global config and user
 * model that Fortify overwrites for the staff guard at boot, and stores challenges in the web session, which a token-based app does not
 * have. Only its AAGUID list is reused (Aaguids).
 *
 * Ceremonies: the options go to the client with a ceremony_id; the server keeps them in passkey_challenges, single use, 5 minutes. User
 * verification required; discoverable credentials for the usernameless sign-in; attestation "none". Allowed origins: https://{rp id},
 * PASSKEY_ALLOWED_ORIGINS and android:apk-key-hash:… from ANDROID_CERT_SHA256.
 */
final class MemberWebAuthn
{
    private ?SerializerInterface $serializer = null;

    public function rpId(): string
    {
        $id = config('speedclub.passkeys.rp_id');

        return is_string($id) && $id !== '' ? $id : 'localhost';
    }

    /**
     * @return list<string>
     */
    public function allowedOrigins(): array
    {
        $appUrl = config()->string('app.url');
        $scheme = parse_url($appUrl, PHP_URL_SCHEME);
        $port = parse_url($appUrl, PHP_URL_PORT);
        $origins = [(is_string($scheme) ? $scheme : 'https').'://'.$this->rpId().(is_int($port) ? ':'.$port : '')];

        /** @var list<string> $extra */
        $extra = config()->array('speedclub.passkeys.allowed_origins');

        foreach (explode(',', (string) config('speedclub.mobile.android_cert_sha256')) as $fingerprint) {
            $hex = strtoupper(str_replace([':', ' '], '', $fingerprint));

            if (preg_match('/\A[0-9A-F]{64}\z/', $hex) === 1) {
                $origins[] = 'android:apk-key-hash:'.Base64UrlSafe::encodeUnpadded((string) hex2bin($hex));
            }
        }

        return array_values(array_unique([...$origins, ...$extra]));
    }

    /**
     * Registration options for the signed-in member (POST me/passkeys/options). Existing credentials are excluded.
     *
     * @return array{ceremony_id: string, options: array<array-key, mixed>}
     */
    public function beginRegistration(User $user): array
    {
        $options = PublicKeyCredentialCreationOptions::create(
            rp: PublicKeyCredentialRpEntity::create(config()->string('speedclub.passkeys.rp_name'), $this->rpId()),
            user: PublicKeyCredentialUserEntity::create(
                $user->email,
                self::userHandle($user),
                is_string($user->username) ? '@'.$user->username : $user->email,
            ),
            challenge: random_bytes(32),
            pubKeyCredParams: [
                PublicKeyCredentialParameters::create(PublicKeyCredentialDescriptor::CREDENTIAL_TYPE_PUBLIC_KEY, Algorithms::COSE_ALGORITHM_ES256),
                PublicKeyCredentialParameters::create(PublicKeyCredentialDescriptor::CREDENTIAL_TYPE_PUBLIC_KEY, Algorithms::COSE_ALGORITHM_RS256),
            ],
            authenticatorSelection: AuthenticatorSelectionCriteria::create(
                authenticatorAttachment: AuthenticatorSelectionCriteria::AUTHENTICATOR_ATTACHMENT_NO_PREFERENCE,
                userVerification: AuthenticatorSelectionCriteria::USER_VERIFICATION_REQUIREMENT_REQUIRED,
                residentKey: AuthenticatorSelectionCriteria::RESIDENT_KEY_REQUIREMENT_REQUIRED,
            ),
            attestation: PublicKeyCredentialCreationOptions::ATTESTATION_CONVEYANCE_PREFERENCE_NONE,
            excludeCredentials: $this->descriptors($user),
            timeout: max(1, config()->integer('speedclub.passkeys.timeout_ms')),
        );

        return $this->begin(PasskeyCeremony::Registration, $user, $options);
    }

    /**
     * Sign-in options (usernameless: no allowCredentials) or, for a signed-in member, re-authentication options with their credentials.
     *
     * @return array{ceremony_id: string, options: array<array-key, mixed>}
     */
    public function beginAssertion(PasskeyCeremony $ceremony, ?User $user = null): array
    {
        $options = PublicKeyCredentialRequestOptions::create(
            challenge: random_bytes(32),
            rpId: $this->rpId(),
            allowCredentials: $user === null ? [] : $this->descriptors($user),
            userVerification: AuthenticatorSelectionCriteria::USER_VERIFICATION_REQUIREMENT_REQUIRED,
            timeout: max(1, config()->integer('speedclub.passkeys.timeout_ms')),
        );

        return $this->begin($ceremony, $user, $options);
    }

    /**
     * Checks a registration response and returns the record to store. Throws 422 passkey_invalid for anything that fails.
     *
     * @param  array<string, mixed>  $credential  the PublicKeyCredential as JSON (id, rawId, type, response.clientDataJSON, .attestationObject)
     * @return array{record: CredentialRecord, response: AuthenticatorAttestationResponse}
     */
    public function finishRegistration(User $user, string $ceremonyId, array $credential): array
    {
        $options = $this->take($ceremonyId, PasskeyCeremony::Registration, $user, PublicKeyCredentialCreationOptions::class);
        $response = $this->credential($credential)->response;

        if (! $response instanceof AuthenticatorAttestationResponse) {
            throw self::invalid();
        }

        try {
            $record = $this->attestationValidator()->check($response, $options, $this->rpId());
        } catch (Throwable) {
            throw self::invalid();
        }

        return ['record' => $record, 'response' => $response];
    }

    /**
     * Checks an assertion against the stored passkey and returns the updated record and the passkey row (locked). With $user, the passkey
     * must be one of theirs. A counter that did not grow throws PasskeyCounterRegressed, which the caller reports.
     *
     * @param  array<string, mixed>  $credential
     * @return array{passkey: MemberPasskey, record: CredentialRecord}
     */
    public function finishAssertion(PasskeyCeremony $ceremony, string $ceremonyId, array $credential, ?User $user = null): array
    {
        $options = $this->take($ceremonyId, $ceremony, $user, PublicKeyCredentialRequestOptions::class);
        $public = $this->credential($credential);
        $response = $public->response;

        if (! $response instanceof AuthenticatorAssertionResponse) {
            throw self::invalid();
        }

        $passkey = MemberPasskey::query()->where('credential_id', Base64UrlSafe::encodeUnpadded($public->rawId))->lockForUpdate()->first();

        if ($passkey === null || ($user !== null && $passkey->user_id !== $user->id)) {
            throw self::invalid();
        }

        try {
            $stored = $this->serializer()->deserialize((string) json_encode($passkey->credential, JSON_THROW_ON_ERROR), CredentialRecord::class, 'json');
            $record = $this->assertionValidator()->check($stored, $response, $options, $this->rpId(), $stored->userHandle);
        } catch (CounterException) {
            throw new PasskeyCounterRegressed($passkey);
        } catch (Throwable) {
            throw self::invalid();
        }

        return ['passkey' => $passkey, 'record' => $record];
    }

    /**
     * @return array<string, mixed>
     */
    public function recordToArray(CredentialRecord $record): array
    {
        /** @var array<string, mixed> */
        return json_decode($this->serializer()->serialize($record, 'json'), true, flags: JSON_THROW_ON_ERROR);
    }

    /**
     * A stable, opaque WebAuthn user handle: no e-mail or id in clear (W3C §14.6.1).
     */
    public static function userHandle(User $user): string
    {
        return hash_hmac('sha256', 'passkey-user|'.$user->getKey(), config()->string('app.key'), binary: true);
    }

    public static function invalid(): ApiException
    {
        return new ApiException(ErrorCode::PasskeyInvalid);
    }

    /**
     * @return array{ceremony_id: string, options: array<array-key, mixed>}
     */
    private function begin(PasskeyCeremony $ceremony, ?User $user, PublicKeyCredentialCreationOptions|PublicKeyCredentialRequestOptions $options): array
    {
        $row = new PasskeyChallenge;
        $row->forceFill([
            'user_id' => $user?->id,
            'ceremony' => $ceremony,
            'options' => json_decode($this->serializer()->serialize($options, 'json'), true, flags: JSON_THROW_ON_ERROR),
            'expires_at' => now()->addSeconds(config()->integer('speedclub.passkeys.challenge_ttl_seconds')),
        ])->save();

        $serializer = $this->serializer();

        if (! $serializer instanceof NormalizerInterface) {
            throw new \LogicException('The WebAuthn serializer cannot normalise.');
        }

        $browser = $serializer->normalize($options, 'json', [AbstractObjectNormalizer::SKIP_NULL_VALUES => true]);

        return ['ceremony_id' => (string) $row->id, 'options' => is_array($browser) ? $browser : []];
    }

    /**
     * Spends the ceremony atomically: a second use, another member's ceremony, another kind or an expired one all fail the same.
     *
     * @template T of PublicKeyCredentialCreationOptions|PublicKeyCredentialRequestOptions
     *
     * @param  class-string<T>  $class
     * @return T
     */
    private function take(string $ceremonyId, PasskeyCeremony $ceremony, ?User $user, string $class): object
    {
        return DB::transaction(function () use ($ceremonyId, $ceremony, $user, $class): object {
            $row = PasskeyChallenge::query()
                ->whereKey($ceremonyId)
                ->where('ceremony', $ceremony)
                ->whereNull('consumed_at')
                ->where('expires_at', '>', now())
                ->when($user !== null, fn ($query) => $query->where('user_id', $user?->id), fn ($query) => $query->whereNull('user_id'))
                ->lockForUpdate()
                ->first();

            if ($row === null) {
                throw self::invalid();
            }

            $row->forceFill(['consumed_at' => now()])->save();

            try {
                return $this->serializer()->deserialize((string) json_encode($row->getAttribute('options'), JSON_THROW_ON_ERROR), $class, 'json');
            } catch (Throwable) {
                throw self::invalid();
            }
        });
    }

    /**
     * @param  array<string, mixed>  $credential
     */
    private function credential(array $credential): PublicKeyCredential
    {
        try {
            return $this->serializer()->deserialize((string) json_encode($credential, JSON_THROW_ON_ERROR), PublicKeyCredential::class, 'json');
        } catch (Throwable) {
            throw self::invalid();
        }
    }

    /**
     * @return list<PublicKeyCredentialDescriptor>
     */
    private function descriptors(User $user): array
    {
        return array_values($user->memberPasskeys()->get()->map(fn (MemberPasskey $passkey): PublicKeyCredentialDescriptor => PublicKeyCredentialDescriptor::create(
            PublicKeyCredentialDescriptor::CREDENTIAL_TYPE_PUBLIC_KEY,
            Base64UrlSafe::decodeNoPadding($passkey->credential_id),
            $passkey->transports ?? [],
        ))->all());
    }

    private function attestationValidator(): AuthenticatorAttestationResponseValidator
    {
        return AuthenticatorAttestationResponseValidator::create(ceremonyStepManager: $this->ceremonies()->creationCeremony());
    }

    private function assertionValidator(): AuthenticatorAssertionResponseValidator
    {
        return AuthenticatorAssertionResponseValidator::create(ceremonyStepManager: $this->ceremonies()->requestCeremony());
    }

    private function ceremonies(): CeremonyStepManagerFactory
    {
        $factory = new CeremonyStepManagerFactory;
        $factory->setAllowedOrigins($this->allowedOrigins());
        $factory->setAttestationStatementSupportManager($this->attestationSupport());

        // Plain http only for a local RP (development and tests), as browsers allow it there too.
        if (in_array($this->rpId(), ['localhost', '127.0.0.1'], true)) {
            $factory->setSecuredRelyingPartyId([$this->rpId()]);
        }

        return $factory;
    }

    private function attestationSupport(): AttestationStatementSupportManager
    {
        $manager = AttestationStatementSupportManager::create();
        $manager->add(NoneAttestationStatementSupport::create());

        return $manager;
    }

    private function serializer(): SerializerInterface
    {
        return $this->serializer ??= (new WebauthnSerializerFactory($this->attestationSupport()))->create();
    }
}
