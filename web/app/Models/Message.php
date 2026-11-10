<?php

namespace App\Models;

use App\Enums\MessageType;
use Database\Factories\MessageFactory;
use Illuminate\Database\Eloquent\Concerns\HasUlids;
use Illuminate\Database\Eloquent\Factories\HasFactory;
use Illuminate\Database\Eloquent\Model;
use Illuminate\Database\Eloquent\Relations\BelongsTo;
use Illuminate\Database\Eloquent\Relations\HasMany;
use Illuminate\Database\Eloquent\SoftDeletes;
use Illuminate\Support\Carbon;

/**
 * A message. The body is the only place a message text is stored (ADR-125): never log it, cache it or copy it elsewhere. Ids are
 * handed out by App\Services\Messaging\MessageIds under the conversation's lock, strictly increasing per conversation.
 *
 * @property string $id
 * @property string $conversation_id
 * @property string|null $sender_id
 * @property string $client_id
 * @property string|null $idempotency_key
 * @property MessageType $type
 * @property string|null $body
 * @property string|null $media_id
 * @property string|null $vehicle_id
 * @property Carbon $created_at
 */
class Message extends Model
{
    /** @use HasFactory<MessageFactory> */
    use HasFactory, HasUlids, SoftDeletes;

    public const UPDATED_AT = null;

    /** created_at keeps microseconds (timestamp(6)). */
    protected $dateFormat = 'Y-m-d H:i:s.u';

    /** Never in a serialised model (a log context, a dump). */
    protected $hidden = ['body', 'idempotency_key'];

    /**
     * @return array<string, string>
     */
    protected function casts(): array
    {
        return ['type' => MessageType::class, 'created_at' => 'datetime'];
    }

    /**
     * @return BelongsTo<Conversation, $this>
     */
    public function conversation(): BelongsTo
    {
        return $this->belongsTo(Conversation::class);
    }

    /**
     * @return BelongsTo<User, $this>
     */
    public function sender(): BelongsTo
    {
        return $this->belongsTo(User::class, 'sender_id')->withTrashed();
    }

    /**
     * @return BelongsTo<Media, $this>
     */
    public function media(): BelongsTo
    {
        return $this->belongsTo(Media::class);
    }

    /**
     * @return BelongsTo<Vehicle, $this>
     */
    public function vehicle(): BelongsTo
    {
        return $this->belongsTo(Vehicle::class)->withTrashed();
    }

    /**
     * @return HasMany<MessageReactionRow, $this>
     */
    public function reactions(): HasMany
    {
        return $this->hasMany(MessageReactionRow::class);
    }
}
