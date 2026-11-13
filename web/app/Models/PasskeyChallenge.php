<?php

namespace App\Models;

use App\Enums\PasskeyCeremony;
use Database\Factories\PasskeyChallengeFactory;
use Illuminate\Database\Eloquent\Attributes\Hidden;
use Illuminate\Database\Eloquent\Concerns\HasUlids;
use Illuminate\Database\Eloquent\Factories\HasFactory;
use Illuminate\Database\Eloquent\Model;
use Illuminate\Database\Eloquent\Relations\BelongsTo;

/**
 * The server half of one WebAuthn ceremony (09 §8.2): the options sent to the client, with their challenge. Single use, 5 minutes,
 * named by its id (the `ceremony_id` of the API).
 */
#[Hidden(['options'])]
class PasskeyChallenge extends Model
{
    /** @use HasFactory<PasskeyChallengeFactory> */
    use HasFactory, HasUlids;

    /**
     * @return array<string, string>
     */
    protected function casts(): array
    {
        return [
            'ceremony' => PasskeyCeremony::class,
            'options' => 'array',
            'expires_at' => 'datetime',
            'consumed_at' => 'datetime',
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
