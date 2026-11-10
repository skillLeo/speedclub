<?php

namespace App\Models;

use App\Enums\MessageReaction;
use Database\Factories\MessageReactionRowFactory;
use Illuminate\Database\Eloquent\Factories\HasFactory;
use Illuminate\Database\Eloquent\Model;
use Illuminate\Database\Eloquent\Relations\BelongsTo;

/**
 * [SIG sig.msg_reactions] One member's reaction to a message (message_reactions). Named …Row so it does not clash with the enum.
 *
 * @property string $message_id
 * @property string $user_id
 * @property MessageReaction $reaction
 */
class MessageReactionRow extends Model
{
    /** @use HasFactory<MessageReactionRowFactory> */
    use HasFactory;

    public const UPDATED_AT = null;

    public $incrementing = false;

    protected $primaryKey = 'message_id';

    protected $table = 'message_reactions';

    protected $fillable = ['message_id', 'user_id', 'reaction'];

    /**
     * @return array<string, string>
     */
    protected function casts(): array
    {
        return ['reaction' => MessageReaction::class];
    }

    /**
     * @return BelongsTo<Message, $this>
     */
    public function message(): BelongsTo
    {
        return $this->belongsTo(Message::class);
    }
}
