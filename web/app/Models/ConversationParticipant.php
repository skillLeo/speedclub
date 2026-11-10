<?php

namespace App\Models;

use App\Enums\ConversationFolder;
use Database\Factories\ConversationParticipantFactory;
use Illuminate\Database\Eloquent\Factories\HasFactory;
use Illuminate\Database\Eloquent\Model;
use Illuminate\Database\Eloquent\Relations\BelongsTo;
use Illuminate\Support\Carbon;

/**
 * One member's side of a conversation: folder, read mark, unread counter, organise state and "delete for me" (deleted_at plus
 * cleared_before_message_id). Not soft-deleting: deleted_at is revived by a later message of the other side (m2.4-contract §1).
 *
 * @property int $id
 * @property string $conversation_id
 * @property string $user_id
 * @property ConversationFolder $folder
 * @property Carbon|null $accepted_at
 * @property string|null $last_read_message_id
 * @property int $unread_count
 * @property Carbon|null $muted_until
 * @property bool $muted_indefinitely
 * @property Carbon|null $pinned_at
 * @property Carbon|null $archived_at
 * @property Carbon|null $deleted_at
 * @property string|null $cleared_before_message_id
 * @property Carbon|null $declined_at
 */
class ConversationParticipant extends Model
{
    /** @use HasFactory<ConversationParticipantFactory> */
    use HasFactory;

    /**
     * @return array<string, string>
     */
    protected function casts(): array
    {
        return [
            'folder' => ConversationFolder::class,
            'accepted_at' => 'datetime',
            'last_read_at' => 'datetime',
            'unread_count' => 'integer',
            'muted_until' => 'datetime',
            'muted_indefinitely' => 'boolean',
            'pinned_at' => 'datetime',
            'archived_at' => 'datetime',
            'deleted_at' => 'datetime',
            'declined_at' => 'datetime',
            'last_message_at' => 'datetime',
        ];
    }

    /**
     * A request the recipient has not accepted yet (it may have declined it: deleted_at).
     */
    public function isPendingRequest(): bool
    {
        return $this->folder === ConversationFolder::Requests && $this->accepted_at === null;
    }

    /**
     * Muted with no end ("Bis du es wieder änderst"), or until a moment still ahead.
     */
    public function isMuted(): bool
    {
        return $this->muted_indefinitely || ($this->muted_until !== null && $this->muted_until->isFuture());
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
    public function user(): BelongsTo
    {
        return $this->belongsTo(User::class)->withTrashed();
    }
}
