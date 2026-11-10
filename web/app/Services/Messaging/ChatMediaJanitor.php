<?php

namespace App\Services\Messaging;

use App\Models\Conversation;
use App\Models\Media;
use App\Models\Message;
use Illuminate\Database\Eloquent\Collection;
use Illuminate\Database\Query\Builder;

/**
 * Which chat photos media:prune removes (lead ruling, M2.4 review #5):
 *
 * - an upload no message took within unused_photo_hours (still held by its conversation, checked again right before the purge, so a
 *   photo a message claimed in between stays);
 * - a sent photo nobody sees any more: no participant left whose account exists and who has neither cleared nor hidden the message (both
 *   deleted the conversation or the message, a block cleared it for both, both accounts deleted), or a message that is gone.
 */
class ChatMediaJanitor
{
    /**
     * @return Collection<int, Media>
     */
    public function unused(int $batch): Collection
    {
        return Media::query()
            ->where('mediable_type', (new Conversation)->getMorphClass())
            ->where('created_at', '<', now()->subHours(config()->integer('speedclub.messaging.unused_photo_hours')))
            ->limit($batch)
            ->get();
    }

    public function stillUnused(Media $media): bool
    {
        return Media::query()->whereKey($media->getKey())->where('mediable_type', (new Conversation)->getMorphClass())->exists();
    }

    /**
     * @return Collection<int, Media>
     */
    public function unseen(int $batch): Collection
    {
        return Media::query()
            ->where('mediable_type', (new Message)->getMorphClass())
            ->whereNotExists(fn (Builder $seen) => $seen->selectRaw('1')
                ->from('messages as m')
                ->join('conversation_participants as p', 'p.conversation_id', '=', 'm.conversation_id')
                ->join('users as u', 'u.id', '=', 'p.user_id')
                ->whereColumn('m.id', 'media.mediable_id')
                ->whereNull('m.deleted_at')
                ->whereNull('u.deleted_at')
                ->where(fn (Builder $cleared) => $cleared->whereNull('p.cleared_before_message_id')->orWhereColumn('m.id', '>', 'p.cleared_before_message_id'))
                ->whereNotExists(fn (Builder $hidden) => $hidden->selectRaw('1')->from('message_hidden as h')->whereColumn('h.message_id', 'm.id')->whereColumn('h.user_id', 'p.user_id')))
            ->limit($batch)
            ->get();
    }
}
