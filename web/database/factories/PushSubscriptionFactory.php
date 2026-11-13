<?php

namespace Database\Factories;

use App\Models\PushSubscription;
use App\Models\User;
use Illuminate\Database\Eloquent\Factories\Factory;

/**
 * @extends Factory<PushSubscription>
 */
class PushSubscriptionFactory extends Factory
{
    /**
     * A subscription with the shape browsers send: an FCM endpoint, a P-256 point (65 bytes) and a 16-byte auth secret, base64url.
     *
     * @return array<string, mixed>
     */
    public function definition(): array
    {
        $endpoint = 'https://fcm.googleapis.com/fcm/send/'.fake()->unique()->regexify('[A-Za-z0-9_-]{40}');

        return [
            'user_id' => User::factory(),
            'endpoint' => $endpoint,
            'endpoint_hash' => PushSubscription::hashEndpoint($endpoint),
            'public_key' => self::base64url(self::p256Point()),
            'auth_token' => self::base64url(random_bytes(16)),
            'content_encoding' => 'aes128gcm',
            'browser' => 'Chrome, macOS',
            'last_used_at' => null,
            'failures' => 0,
        ];
    }

    /**
     * At a given endpoint (its hash follows).
     */
    public function endpoint(string $endpoint): static
    {
        return $this->state(fn (): array => ['endpoint' => $endpoint, 'endpoint_hash' => PushSubscription::hashEndpoint($endpoint)]);
    }

    /**
     * A real uncompressed P-256 public key (0x04 ‖ x ‖ y), so the payload encryption of minishlink/web-push works in tests.
     */
    public static function p256Point(): string
    {
        $key = openssl_pkey_new(['curve_name' => 'prime256v1', 'private_key_type' => OPENSSL_KEYTYPE_EC]);
        $details = $key === false ? false : openssl_pkey_get_details($key);

        if (! is_array($details) || ! is_string($details['ec']['x'] ?? null) || ! is_string($details['ec']['y'] ?? null)) {
            throw new \RuntimeException('OpenSSL could not create a P-256 key.');
        }

        return "\x04".str_pad($details['ec']['x'], 32, "\0", STR_PAD_LEFT).str_pad($details['ec']['y'], 32, "\0", STR_PAD_LEFT);
    }

    public static function base64url(string $bytes): string
    {
        return rtrim(strtr(base64_encode($bytes), '+/', '-_'), '=');
    }
}
