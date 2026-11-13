<?php

namespace Tests\Support;

use CBOR\ByteStringObject;
use CBOR\MapObject;
use CBOR\NegativeIntegerObject;
use CBOR\TextStringObject;
use CBOR\UnsignedIntegerObject;
use OpenSSLAsymmetricKey;
use ParagonIE\ConstantTime\Base64UrlSafe;
use RuntimeException;

/**
 * A software passkey for the Pest ceremonies (09 §8.2 "Pest with recorded ceremony fixtures"): a P-256 key, attestation "none", user
 * verification and backup flags set, a signature counter it raises on every assertion. It answers the server's options exactly as a
 * platform authenticator would (clientDataJSON, authenticatorData, CBOR attestationObject, DER ECDSA signature), so the real
 * web-auth/webauthn-lib validators run end to end. Fixed key material makes a run reproducible; the challenge comes from the server.
 */
final class VirtualAuthenticator
{
    /** iCloud-Schlüsselbund. */
    public const AAGUID = 'fbfc3007-154e-4ecc-8c0b-6e020557d7bd';

    private OpenSSLAsymmetricKey $key;

    public string $credentialId;

    public ?string $userHandle = null;

    public int $counter = 0;

    public function __construct(?string $credentialId = null)
    {
        $key = openssl_pkey_new(['private_key_type' => OPENSSL_KEYTYPE_EC, 'curve_name' => 'prime256v1']);

        if ($key === false) {
            throw new RuntimeException('No EC key.');
        }

        $this->key = $key;
        $this->credentialId = $credentialId ?? random_bytes(32);
    }

    /**
     * The PublicKeyCredential JSON of navigator.credentials.create() for these creation options.
     *
     * @param  array<string, mixed>  $options
     * @return array<string, mixed>
     */
    public function register(array $options, string $origin, ?string $rpId = null): array
    {
        /** @var array{id: string} $rp */
        $rp = $options['rp'];
        /** @var array{id: string} $user */
        $user = $options['user'];
        $this->userHandle = Base64UrlSafe::decodeNoPadding($user['id']);

        $clientData = $this->clientData('webauthn.create', (string) $options['challenge'], $origin);
        $authData = hash('sha256', $rpId ?? $rp['id'], true)
            .chr(0x01 | 0x04 | 0x08 | 0x10 | 0x40)
            .pack('N', $this->counter)
            .(string) hex2bin(str_replace('-', '', self::AAGUID))
            .pack('n', strlen($this->credentialId))
            .$this->credentialId
            .$this->coseKey();

        $attestation = MapObject::create()
            ->add(TextStringObject::create('fmt'), TextStringObject::create('none'))
            ->add(TextStringObject::create('attStmt'), MapObject::create())
            ->add(TextStringObject::create('authData'), ByteStringObject::create($authData));

        return [
            'id' => Base64UrlSafe::encodeUnpadded($this->credentialId),
            'rawId' => Base64UrlSafe::encodeUnpadded($this->credentialId),
            'type' => 'public-key',
            'response' => [
                'clientDataJSON' => Base64UrlSafe::encodeUnpadded($clientData),
                'attestationObject' => Base64UrlSafe::encodeUnpadded((string) $attestation),
                'transports' => ['internal', 'hybrid'],
            ],
            'clientExtensionResults' => [],
            'authenticatorAttachment' => 'platform',
        ];
    }

    /**
     * The PublicKeyCredential JSON of navigator.credentials.get(). $counter overrides the next counter (for the regression test).
     *
     * @param  array<string, mixed>  $options
     * @return array<string, mixed>
     */
    public function assert(array $options, string $origin, ?int $counter = null, ?string $rpId = null): array
    {
        $this->counter = $counter ?? $this->counter + 1;

        $clientData = $this->clientData('webauthn.get', (string) $options['challenge'], $origin);
        $authData = hash('sha256', $rpId ?? (string) $options['rpId'], true).chr(0x01 | 0x04 | 0x08 | 0x10).pack('N', $this->counter);

        openssl_sign($authData.hash('sha256', $clientData, true), $signature, $this->key, OPENSSL_ALGO_SHA256);

        return [
            'id' => Base64UrlSafe::encodeUnpadded($this->credentialId),
            'rawId' => Base64UrlSafe::encodeUnpadded($this->credentialId),
            'type' => 'public-key',
            'response' => [
                'clientDataJSON' => Base64UrlSafe::encodeUnpadded($clientData),
                'authenticatorData' => Base64UrlSafe::encodeUnpadded($authData),
                'signature' => Base64UrlSafe::encodeUnpadded((string) $signature),
                'userHandle' => $this->userHandle === null ? null : Base64UrlSafe::encodeUnpadded($this->userHandle),
            ],
            'clientExtensionResults' => [],
            'authenticatorAttachment' => 'platform',
        ];
    }

    private function clientData(string $type, string $challenge, string $origin): string
    {
        return (string) json_encode(['type' => $type, 'challenge' => $challenge, 'origin' => $origin, 'crossOrigin' => false], JSON_UNESCAPED_SLASHES);
    }

    private function coseKey(): string
    {
        $details = openssl_pkey_get_details($this->key);

        if ($details === false || ! isset($details['ec']['x'], $details['ec']['y'])) {
            throw new RuntimeException('No EC key details.');
        }

        $x = str_pad($details['ec']['x'], 32, "\0", STR_PAD_LEFT);
        $y = str_pad($details['ec']['y'], 32, "\0", STR_PAD_LEFT);

        return (string) MapObject::create()
            ->add(UnsignedIntegerObject::create(1), UnsignedIntegerObject::create(2))
            ->add(UnsignedIntegerObject::create(3), NegativeIntegerObject::create(-7))
            ->add(NegativeIntegerObject::create(-1), UnsignedIntegerObject::create(1))
            ->add(NegativeIntegerObject::create(-2), ByteStringObject::create($x))
            ->add(NegativeIntegerObject::create(-3), ByteStringObject::create($y));
    }
}
