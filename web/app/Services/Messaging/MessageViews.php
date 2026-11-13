<?php

namespace App\Services\Messaging;

use App\Enums\MessageReaction;
use App\Enums\MessageType;
use App\Models\ConversationParticipant;
use App\Models\Message;
use App\Models\MessageReactionRow;
use App\Models\User;
use App\Models\Vehicle;
use App\Services\AppConfig\FeatureFlags;
use Illuminate\Database\Eloquent\Collection;
use Illuminate\Support\Facades\Gate;

/**
 * Builds MessageView for a page of a thread with a fixed number of queries: senders, photos, vehicles, reactions.
 */
class MessageViews
{
    public function __construct(private readonly FeatureFlags $flags) {}

    /**
     * @param  iterable<Message>  $messages
     * @return list<MessageView>
     */
    public function build(User $reader, iterable $messages): array
    {
        $messages = new Collection(collect($messages)->values()->all());

        if ($messages->isEmpty()) {
            return [];
        }

        $messages->load(['sender.avatar', 'media', 'vehicle' => fn ($query) => $query->with(ConversationViews::VEHICLE_RELATIONS)]);
        $reactions = $this->reactions($reader, array_values($messages->map(fn (Message $message): string => $message->id)->all()));
        $quotes = $this->quotes($reader, $messages);
        $allowed = [];

        return array_values($messages->map(function (Message $message) use ($reader, $reactions, $quotes, &$allowed): MessageView {
            $vehicle = $message->vehicle;

            if ($vehicle instanceof Vehicle && ! array_key_exists($vehicle->id, $allowed)) {
                $allowed[$vehicle->id] = Gate::forUser($reader)->allows('view', $vehicle);
            }

            return new MessageView(
                message: $message,
                mine: $message->sender_id === $reader->id,
                vehicle: $vehicle instanceof Vehicle && $allowed[$vehicle->id] ? $vehicle : null,
                reactions: $reactions[$message->id] ?? [],
                replyTo: $message->reply_to_id === null ? null : ($quotes[$message->reply_to_id] ?? null),
            );
        })->all());
    }

    public function one(User $reader, Message $message): MessageView
    {
        return $this->build($reader, [$message])[0];
    }

    /**
     * SM11 (ADR-445): the quoted messages of a page, keyed by id, in two queries. A quote the reader no longer sees (removed, deleted for
     * the reader, before the reader's clearing point, or gone) keeps its id and type with `available` false and no text, so the app
     * shows "Nachricht nicht mehr verfügbar" instead of the text.
     *
     * @param  Collection<int, Message>  $messages
     * @return array<string, array{id: string, type: MessageType, body: string|null, is_mine: bool, available: bool}>
     */
    private function quotes(User $reader, Collection $messages): array
    {
        $ids = array_values(array_unique(array_filter($messages->map(fn (Message $message): ?string => $message->reply_to_id)->all(), is_string(...))));

        if ($ids === []) {
            return [];
        }

        $quoted = Message::withTrashed()->whereKey($ids)->get(['id', 'conversation_id', 'sender_id', 'type', 'body', 'deleted_at']);
        $sides = ConversationParticipant::query()->where('user_id', $reader->id)
            ->whereIn('conversation_id', $quoted->pluck('conversation_id')->unique()->values()->all())->get()->keyBy('conversation_id');
        $visible = [];

        foreach ($sides as $side) {
            foreach (app(Conversations::class)->visibleMessages($side)->whereKey($ids)->pluck('messages.id') as $id) {
                $visible[(string) $id] = true;
            }
        }

        $quotes = [];

        foreach ($quoted as $quote) {
            $available = isset($visible[$quote->id]);
            $quotes[$quote->id] = [
                'id' => $quote->id,
                'type' => $quote->type,
                'body' => $available && $quote->type === MessageType::Text ? $quote->body : null,
                'is_mine' => $quote->sender_id === $reader->id,
                'available' => $available,
            ];
        }

        return $quotes;
    }

    /**
     * [SIG sig.msg_reactions] Per message, in the fixed order of the keys (MessageReaction): count and whether one is the reader's.
     *
     * @param  list<string>  $ids
     * @return array<string, list<array{key: string, count: int, mine: bool}>>
     */
    private function reactions(User $reader, array $ids): array
    {
        if (! $this->flags->enabled('sig.msg_reactions')) {
            return [];
        }

        $rows = MessageReactionRow::query()
            ->whereIn('message_id', $ids)
            ->selectRaw('message_id, reaction, COUNT(*) as total, MAX(CASE WHEN user_id = ? THEN 1 ELSE 0 END) as mine', [$reader->id])
            ->groupBy('message_id', 'reaction')
            ->toBase()
            ->get();

        $order = array_flip(array_map(fn (MessageReaction $case): string => $case->value, MessageReaction::cases()));
        $byMessage = [];

        foreach ($rows as $row) {
            /** @var object{message_id: string, reaction: string, total: int|string, mine: int|string} $row */
            if (! isset($order[$row->reaction])) {
                continue;
            }

            $byMessage[$row->message_id][] = ['key' => $row->reaction, 'count' => (int) $row->total, 'mine' => (int) $row->mine === 1];
        }

        foreach ($byMessage as &$list) {
            usort($list, fn (array $a, array $b): int => $order[$a['key']] <=> $order[$b['key']]);
        }

        return $byMessage;
    }
}
