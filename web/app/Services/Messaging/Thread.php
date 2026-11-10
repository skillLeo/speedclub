<?php

namespace App\Services\Messaging;

use App\Models\ConversationParticipant;
use App\Models\Message;
use Illuminate\Support\Collection;

/**
 * MSG-02's messages (m2.4-contract §2): the newest page, `before` an id (newest first) or `after` an id (oldest first, polling). Ids are
 * strictly increasing per conversation (MessageIds), so `after` never skips a message that committed late.
 */
class Thread
{
    public function __construct(private readonly Conversations $conversations) {}

    /**
     * @return array{0: Collection<int, Message>, 1: bool} the messages in answer order, and whether more lie beyond them
     */
    public function page(ConversationParticipant $reader, ?string $before, ?string $after, int $limit): array
    {
        $query = $this->conversations->visibleMessages($reader);

        if ($after !== null) {
            $rows = $query->where('messages.id', '>', $after)->orderBy('messages.id')->limit($limit + 1)->get();
        } else {
            if ($before !== null) {
                $query->where('messages.id', '<', $before);
            }

            $rows = $query->orderByDesc('messages.id')->limit($limit + 1)->get();
        }

        $more = $rows->count() > $limit;

        return [$rows->take($limit)->values(), $more];
    }
}
