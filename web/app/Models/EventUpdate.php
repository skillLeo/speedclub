<?php

namespace App\Models;

use Database\Factories\EventUpdateFactory;
use Illuminate\Database\Eloquent\Concerns\HasUlids;
use Illuminate\Database\Eloquent\Factories\HasFactory;
use Illuminate\Database\Eloquent\Model;
use Illuminate\Database\Eloquent\Relations\BelongsTo;

/**
 * An organiser's note to the attendees of an event (EVT-06 "Update an Teilnehmer"), read by the organiser and members with an answer.
 *
 * @property string $id
 * @property string $event_id
 * @property string $author_id
 * @property string $body
 * @property-read Event $event
 */
class EventUpdate extends Model
{
    /** @use HasFactory<EventUpdateFactory> */
    use HasFactory, HasUlids;

    /** @var list<string> */
    protected $fillable = ['event_id', 'author_id', 'body'];

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
    public function author(): BelongsTo
    {
        return $this->belongsTo(User::class, 'author_id');
    }
}
