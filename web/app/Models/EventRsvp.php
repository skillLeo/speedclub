<?php

namespace App\Models;

use App\Enums\RsvpStatus;
use Carbon\CarbonImmutable;
use Database\Factories\EventRsvpFactory;
use Illuminate\Database\Eloquent\Concerns\HasUlids;
use Illuminate\Database\Eloquent\Factories\HasFactory;
use Illuminate\Database\Eloquent\Model;
use Illuminate\Database\Eloquent\Relations\BelongsTo;

/**
 * A member's answer to an event (09 §8.7): going, interested or waitlist; status_at orders the waitlist. Written by
 * App\Services\Events\Rsvps only, under the event's row lock.
 *
 * @property string $id
 * @property string $event_id
 * @property string $user_id
 * @property RsvpStatus $status
 * @property CarbonImmutable $status_at
 * @property CarbonImmutable|null $removed_at
 * @property-read Event $event
 * @property-read User $user
 */
class EventRsvp extends Model
{
    /** @use HasFactory<EventRsvpFactory> */
    use HasFactory, HasUlids;

    /** @var list<string> */
    protected $fillable = ['event_id', 'user_id', 'status', 'status_at'];

    /**
     * @return array<string, string>
     */
    protected function casts(): array
    {
        return [
            'status' => RsvpStatus::class,
            'status_at' => 'immutable_datetime',
            'removed_at' => 'immutable_datetime',
        ];
    }

    /**
     * @return BelongsTo<Event, $this>
     */
    public function event(): BelongsTo
    {
        return $this->belongsTo(Event::class);
    }

    /**
     * @return BelongsTo<User, $this>
     */
    public function user(): BelongsTo
    {
        return $this->belongsTo(User::class);
    }
}
