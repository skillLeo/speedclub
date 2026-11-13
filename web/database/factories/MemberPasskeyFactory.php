<?php

namespace Database\Factories;

use App\Models\MemberPasskey;
use App\Models\User;
use Illuminate\Database\Eloquent\Factories\Factory;
use ParagonIE\ConstantTime\Base64UrlSafe;

/**
 * A stored passkey without a usable public key: for lists, renames and deletes. Ceremonies in tests use the virtual authenticator
 * (tests/Support/VirtualAuthenticator.php), which stores real ones.
 *
 * @extends Factory<MemberPasskey>
 */
class MemberPasskeyFactory extends Factory
{
    /**
     * @return array<string, mixed>
     */
    public function definition(): array
    {
        return [
            'user_id' => User::factory(),
            'name' => 'iPhone',
            'credential_id' => Base64UrlSafe::encodeUnpadded(random_bytes(32)),
            'credential' => [],
            'aaguid' => 'fbfc3007-154e-4ecc-8c0b-6e020557d7bd',
            'transports' => ['internal', 'hybrid'],
            'backup_eligible' => true,
            'backed_up' => true,
            'sign_count' => 0,
        ];
    }
}
