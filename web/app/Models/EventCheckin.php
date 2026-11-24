<?php

namespace App\Models;

use App\Enums\CheckinMethod;
use Carbon\CarbonImmutable;
use Database\Factories\EventCheckinFactory;
use Illuminate\Database\Eloquent\Concerns\HasUlids;
use Illuminate\Database\Eloquent\Factories\HasFactory;
use Illuminate\Database\Eloquent\Model;
use Illuminate\Database\Eloquent\Relations\BelongsTo;

/**
 * M5.6 (10 §4, m5.6-contract §5.1): "War dabei". Who checked in to which event, and when; whether it shows on the member's profile (after
 * the event has ended only, never live, 10 §16). Deliberately no location, device or IP: being in front of the organiser is the proof.
 *
 * @property string $id
 * @property string $event_id
 * @property string $user_id
 * @property CarbonImmutable $checked_in_at
 * @property bool $profile_visible
 * @property CheckinMethod $method
 * @property-read Event $event
 * @property-read User $user
 */
class EventCheckin extends Model
{
    /** @use HasFactory<EventCheckinFactory> */
    use HasFactory, HasUlids;

    /** @var list<string> */
    protected $fillable = ['profile_visible'];

    /**
     * @return array<string, string>
     */
    protected function casts(): array
    {
        return [
            'checked_in_at' => 'immutable_datetime',
            'profile_visible' => 'boolean',
            'method' => CheckinMethod::class,
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
