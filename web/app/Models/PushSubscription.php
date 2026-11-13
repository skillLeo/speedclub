<?php

namespace App\Models;

use Database\Factories\PushSubscriptionFactory;
use Illuminate\Database\Eloquent\Attributes\Hidden;
use Illuminate\Database\Eloquent\Concerns\HasUlids;
use Illuminate\Database\Eloquent\Factories\HasFactory;
use Illuminate\Database\Eloquent\Model;
use Illuminate\Database\Eloquent\Relations\BelongsTo;
use Illuminate\Support\Carbon;

/**
 * A browser's Web Push subscription of the member web (M4.15, ADR-452). Endpoint and keys are encrypted at rest; endpoint_hash finds
 * the row of an endpoint. Written only through RegisterPushSubscription (forceFill), never mass-assigned.
 *
 * @property string $id
 * @property string $user_id
 * @property string $endpoint_hash
 * @property string|null $session_key
 * @property string $endpoint
 * @property string $public_key
 * @property string $auth_token
 * @property string $content_encoding
 * @property string|null $browser
 * @property Carbon|null $last_used_at
 * @property int $failures
 * @property Carbon|null $created_at
 * @property Carbon|null $updated_at
 */
#[Hidden(['endpoint', 'endpoint_hash', 'session_key', 'public_key', 'auth_token'])]
class PushSubscription extends Model
{
    /** @use HasFactory<PushSubscriptionFactory> */
    use HasFactory, HasUlids;

    /**
     * @return array<string, string>
     */
    protected function casts(): array
    {
        return [
            'endpoint' => 'encrypted',
            'public_key' => 'encrypted',
            'auth_token' => 'encrypted',
            'last_used_at' => 'datetime',
            'failures' => 'integer',
        ];
    }

    /**
     * The lookup key of an endpoint: the endpoint is encrypted, so it cannot be searched for itself.
     */
    public static function hashEndpoint(string $endpoint): string
    {
        return hash('sha256', $endpoint);
    }

    /**
     * The stored reference of a member web session: a hash, as the session id itself would sign that browser in.
     */
    public static function sessionKey(string $sessionId): string
    {
        return hash('sha256', $sessionId);
    }

    /**
     * @return BelongsTo<User, $this>
     */
    public function user(): BelongsTo
    {
        return $this->belongsTo(User::class);
    }
}
