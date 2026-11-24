<?php

namespace App\Models;

use Database\Factories\WrappedFactory;
use Illuminate\Database\Eloquent\Concerns\HasUlids;
use Illuminate\Database\Eloquent\Factories\HasFactory;
use Illuminate\Database\Eloquent\Model;
use Illuminate\Database\Eloquent\Relations\BelongsTo;
use Illuminate\Support\Carbon;

/**
 * M5.9e Season Wrapped (10 §16.5, m5.9e contract §1): one member's payload for one season (`2027-saison`, `2027-jahr`). Written only by
 * App\Services\Wrapped\WrappedGenerator (idempotent on user_id + season_key); `viewed_at` and `shared_count` by the member's reads.
 * The payload is the stored version 1 (App\Services\Wrapped\WrappedPayloadBuilder): references and numbers, no URLs, no words.
 *
 * @property string $id
 * @property string $user_id
 * @property string $season_key
 * @property array<string, mixed> $payload
 * @property bool $is_sample
 * @property Carbon $generated_at
 * @property Carbon|null $viewed_at
 * @property int $shared_count
 * @property User $user
 */
class Wrapped extends Model
{
    /** @use HasFactory<WrappedFactory> */
    use HasFactory, HasUlids;

    protected $table = 'wrapped';

    /** Nothing is mass assignable: the generator and the actions set every column through forceFill. */
    protected $guarded = ['*'];

    /**
     * @return array<string, string>
     */
    protected function casts(): array
    {
        return [
            'payload' => 'array',
            'is_sample' => 'boolean',
            'generated_at' => 'datetime',
            'viewed_at' => 'datetime',
            'shared_count' => 'integer',
        ];
    }

    /**
     * @return BelongsTo<User, $this>
     */
    public function user(): BelongsTo
    {
        return $this->belongsTo(User::class);
    }

    /**
     * The stored cards in their order (each `{kind, …}`).
     *
     * @return list<array<string, mixed>>
     */
    public function cards(): array
    {
        $cards = $this->payload['cards'] ?? [];

        return is_array($cards) ? array_values(array_filter($cards, is_array(...))) : [];
    }
}
