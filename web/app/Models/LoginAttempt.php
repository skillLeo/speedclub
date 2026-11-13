<?php

namespace App\Models;

use App\Enums\LoginPurpose;
use Database\Factories\LoginAttemptFactory;
use Illuminate\Database\Eloquent\Attributes\Hidden;
use Illuminate\Database\Eloquent\Concerns\HasUlids;
use Illuminate\Database\Eloquent\Factories\HasFactory;
use Illuminate\Database\Eloquent\Model;
use Illuminate\Database\Eloquent\Relations\BelongsTo;
use Illuminate\Support\Carbon;

/**
 * One e-mail code of the passwordless flows (09 §8.1, App\Services\Auth\EmailCodes). Written only by that service, through forceFill.
 *
 * payload (encrypted array): the provider identity of a pending AUTH-16 link, never shown to anybody.
 *
 * @property string $id
 * @property string $email_hash
 * @property string $attempt_hash
 * @property string|null $user_id
 * @property LoginPurpose $purpose
 * @property string $code_hash
 * @property string|null $magic_hash
 * @property int $attempts
 * @property Carbon|null $expires_at
 * @property Carbon|null $consumed_at
 * @property array<string, mixed>|null $payload
 */
#[Hidden(['code_hash', 'magic_hash', 'attempt_hash', 'email_hash', 'payload'])]
class LoginAttempt extends Model
{
    /** @use HasFactory<LoginAttemptFactory> */
    use HasFactory, HasUlids;

    /**
     * @return array<string, string>
     */
    protected function casts(): array
    {
        return [
            'purpose' => LoginPurpose::class,
            'attempts' => 'integer',
            'expires_at' => 'datetime',
            'consumed_at' => 'datetime',
            'payload' => 'encrypted:array',
        ];
    }

    /**
     * @return BelongsTo<User, $this>
     */
    public function user(): BelongsTo
    {
        return $this->belongsTo(User::class);
    }

    public function isOpen(): bool
    {
        return $this->consumed_at === null && $this->expires_at !== null && $this->expires_at->isFuture();
    }
}
