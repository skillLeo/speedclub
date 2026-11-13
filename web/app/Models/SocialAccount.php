<?php

namespace App\Models;

use App\Enums\SocialProvider;
use Database\Factories\SocialAccountFactory;
use Illuminate\Database\Eloquent\Attributes\Hidden;
use Illuminate\Database\Eloquent\Concerns\HasUlids;
use Illuminate\Database\Eloquent\Factories\HasFactory;
use Illuminate\Database\Eloquent\Model;
use Illuminate\Database\Eloquent\Relations\BelongsTo;

/**
 * A linked Apple or Google identity (09 §8.1). provider_sub is the token's `sub`; the Apple refresh token (only with the .p8 key) is
 * stored encrypted and used once, for the revoke at account deletion.
 *
 * @property string $id
 * @property string $user_id
 * @property SocialProvider $provider
 * @property string $provider_sub
 */
#[Hidden(['provider_sub', 'refresh_token_encrypted'])]
class SocialAccount extends Model
{
    /** @use HasFactory<SocialAccountFactory> */
    use HasFactory, HasUlids;

    /**
     * @return array<string, string>
     */
    protected function casts(): array
    {
        return [
            'provider' => SocialProvider::class,
            'email_verified' => 'boolean',
            'is_private_relay' => 'boolean',
            'refresh_token_encrypted' => 'encrypted',
            'last_used_at' => 'datetime',
            // SEC-M46-02: the last time this provider was tied to a passed second factor.
            'second_factor_at' => 'datetime',
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
