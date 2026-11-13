<?php

namespace App\Models;

use Database\Factories\MemberPasskeyFactory;
use Illuminate\Database\Eloquent\Attributes\Hidden;
use Illuminate\Database\Eloquent\Concerns\HasUlids;
use Illuminate\Database\Eloquent\Factories\HasFactory;
use Illuminate\Database\Eloquent\Model;
use Illuminate\Database\Eloquent\Relations\BelongsTo;

/**
 * A member's WebAuthn credential (09 §8.2, ADR-409). credential is the serialised Webauthn\CredentialRecord (public key, counter, user
 * handle); credential_id its base64url id without padding. Members only: staff keep Fortify (ADR-011).
 *
 * @property string $id
 * @property string $user_id
 * @property string $name
 * @property string $credential_id
 * @property array<string, mixed> $credential
 * @property string|null $aaguid
 * @property list<string>|null $transports
 * @property int $sign_count
 */
#[Hidden(['credential'])]
class MemberPasskey extends Model
{
    /** @use HasFactory<MemberPasskeyFactory> */
    use HasFactory, HasUlids;

    /**
     * @return array<string, string>
     */
    protected function casts(): array
    {
        return [
            'credential' => 'array',
            'transports' => 'array',
            'backup_eligible' => 'boolean',
            'backed_up' => 'boolean',
            'sign_count' => 'integer',
            'last_used_at' => 'datetime',
        ];
    }

    /**
     * @return BelongsTo<User, $this>
     */
    public function user(): BelongsTo
    {
        return $this->belongsTo(User::class);
    }
}
