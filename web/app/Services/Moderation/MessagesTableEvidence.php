<?php

namespace App\Services\Moderation;

use App\Models\ConversationParticipant;
use App\Models\Message;
use App\Services\Messaging\Conversations;

/**
 * Reads the M2.4 `messages` table (m2.4-api-handover §10): the reported message plus up to speedclub.moderation.message_context (5)
 * messages before and after it in its conversation, by id, which is the conversation's order (ids strictly increasing per conversation,
 * MessageIds). The context is what the **reporter** still sees (M2.6 review #9, Conversations::visibleFor): nothing withdrawn, nothing
 * before their clearing point (a block, "delete for me"), nothing they hid. The reported message itself is always kept, as it is what
 * they report. Senders are named by role, never by id: the reported member, the reporter, or `other` for a deleted account.
 */
class MessagesTableEvidence implements MessageEvidence
{
    public function __construct(private readonly Conversations $conversations) {}

    public function snapshot(Message $message, string $reporterId, bool $withContext): array
    {
        $context = config()->integer('speedclub.moderation.message_context', 5);
        $rows = [$message];
        $reader = ConversationParticipant::query()->where('conversation_id', $message->conversation_id)->where('user_id', $reporterId)->first();

        if ($withContext && $context > 0 && $reader instanceof ConversationParticipant) {
            $before = $this->conversations->visibleMessages($reader)->where('messages.id', '<', $message->id)->orderByDesc('messages.id')->limit($context)->get();
            $after = $this->conversations->visibleMessages($reader)->where('messages.id', '>', $message->id)->orderBy('messages.id')->limit($context)->get();
            $rows = [...array_reverse($before->all()), $message, ...$after->all()];
        }

        $snapshot = [];

        foreach ($rows as $row) {
            $snapshot[] = [
                'id' => $row->id,
                'from' => $this->role($row, $message, $reporterId),
                'type' => $row->type->value,
                'body' => $row->body,
                'media_id' => $row->media_id,
                'vehicle_id' => $row->vehicle_id,
                'created_at' => $row->created_at->toIso8601String(),
                'reported' => $row->id === $message->id,
            ];
        }

        return $snapshot;
    }

    /**
     * M3.4 (ADM-22, m3.4-contract §1): up to $count live messages before and after the reported one, read as the reporter sees the
     * conversation now (the same visibility as the snapshot), for a staff member who asked for more context. Empty when the reporter or
     * the conversation is gone. The caller audits the opening.
     *
     * @return list<array{id: string, from: 'reported'|'reporter'|'other', type: string, body: string|null, media_id: string|null, vehicle_id: string|null, created_at: string|null, reported: bool}>
     */
    public function around(Message $message, string $reporterId, int $count): array
    {
        $reader = ConversationParticipant::query()->where('conversation_id', $message->conversation_id)->where('user_id', $reporterId)->first();

        if (! $reader instanceof ConversationParticipant || $count < 1) {
            return [];
        }

        $before = $this->conversations->visibleMessages($reader)->where('messages.id', '<', $message->id)->orderByDesc('messages.id')->limit($count)->get();
        $after = $this->conversations->visibleMessages($reader)->where('messages.id', '>', $message->id)->orderBy('messages.id')->limit($count)->get();
        $rows = [...array_reverse($before->all()), $message, ...$after->all()];

        return array_map(fn (Message $row): array => [
            'id' => $row->id,
            'from' => $this->role($row, $message, $reporterId),
            'type' => $row->type->value,
            'body' => $row->trashed() ? null : $row->body,
            'media_id' => $row->media_id,
            'vehicle_id' => $row->vehicle_id,
            'created_at' => $row->created_at->toIso8601String(),
            'reported' => $row->id === $message->id,
        ], $rows);
    }

    /**
     * @return 'reported'|'reporter'|'other'
     */
    private function role(Message $row, Message $reported, string $reporterId): string
    {
        if ($row->sender_id !== null && $row->sender_id === $reported->sender_id) {
            return 'reported';
        }

        return $row->sender_id === $reporterId ? 'reporter' : 'other';
    }
}
