<?php

namespace App\Models;

use Carbon\CarbonImmutable;
use Database\Factories\EventCheckinCodeFactory;
use Illuminate\Database\Eloquent\Concerns\HasUlids;
use Illuminate\Database\Eloquent\Factories\HasFactory;
use Illuminate\Database\Eloquent\Model;
use Illuminate\Database\Eloquent\Relations\BelongsTo;

/**
 * M5.6 (m5.6-contract §5.1): the organiser's rotating check-in code. One is current per event; it is replaced after
 * speedclub.events.checkin_code_ttl seconds and the one before still counts for checkin_code_grace seconds. `expires_at` is the end of
 * its own term (created_at + ttl); App\Services\Events\EventCheckins adds the grace when it compares. Written by that service only.
 *
 * @property string $id
 * @property string $event_id
 * @property string $code
 * @property CarbonImmutable $expires_at
 * @property CarbonImmutable|null $created_at
 * @property-read Event $event
 */
class EventCheckinCode extends Model
{
    /** @use HasFactory<EventCheckinCodeFactory> */
    use HasFactory, HasUlids;

    public const UPDATED_AT = null;

    /** @var list<string> */
    protected $fillable = [];

    /**
     * @return array<string, string>
     */
    protected function casts(): array
    {
        return [
            'expires_at' => 'immutable_datetime',
            'created_at' => 'immutable_datetime',
        ];
    }

    /**
     * @return BelongsTo<Event, $this>
     */
    public function event(): BelongsTo
    {
        return $this->belongsTo(Event::class);
    }
}
