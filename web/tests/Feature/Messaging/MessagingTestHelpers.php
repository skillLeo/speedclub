<?php

use App\Actions\Messaging\SendMessage;
use App\Actions\Messaging\StartConversation;
use App\Enums\MessageType;
use App\Models\Conversation;
use App\Models\ConversationParticipant;
use App\Models\FeatureFlag;
use App\Models\Message;
use App\Models\User;
use Illuminate\Support\Str;
use Laravel\Sanctum\Sanctum;

require_once __DIR__.'/../Notifications/NotificationTestHelpers.php';

/**
 * M2.4 messaging test helpers, prefixed msg… so they never collide with another file's functions.
 */
function msgFlags(bool $enabled = true): void
{
    foreach (['sig.msg_typing', 'sig.msg_read_receipts', 'sig.msg_reactions', 'sig.msg_organize'] as $key) {
        FeatureFlag::query()->updateOrCreate(['key' => $key], ['enabled' => $enabled]);
    }
}

/**
 * @return array{type: MessageType, body: string|null, media_id: string|null, vehicle_id: string|null, client_id: string}
 */
function msgText(string $body = 'Moin! Wie fährt sich das KW V3?', ?string $clientId = null): array
{
    return ['type' => MessageType::Text, 'body' => $body, 'media_id' => null, 'vehicle_id' => null, 'client_id' => $clientId ?? (string) Str::uuid()];
}

/**
 * A conversation started by $sender through the action, as POST conversations would. $chat: the recipient follows the sender first, so
 * it lands in Chats; otherwise it is a request.
 */
function msgStart(User $sender, User $recipient, string $body = 'Moin! Wie fährt sich das KW V3?', bool $chat = true): Message
{
    if ($chat) {
        socFollow($recipient, $sender);
    }

    return app(StartConversation::class)->handle($sender, $recipient, null, msgText($body), null)->message;
}

function msgSend(User $sender, string $conversationId, string $body = 'Passt, danke dir!'): Message
{
    $participant = ConversationParticipant::query()->where('conversation_id', $conversationId)->where('user_id', $sender->id)->firstOrFail();

    return app(SendMessage::class)->handle($sender, $participant, msgText($body), null)->message;
}

function msgSide(string $conversationId, User $member): ConversationParticipant
{
    return ConversationParticipant::query()->where('conversation_id', $conversationId)->where('user_id', $member->id)->firstOrFail();
}

function msgConversation(User $first, User $second): ?Conversation
{
    return Conversation::query()->where('pair_key', Conversation::pairKey($first, $second))->first();
}

function msgActAs(?User $member): void
{
    if ($member !== null) {
        Sanctum::actingAs($member);
    }
}

/**
 * @param  array<string, mixed>  $overrides
 * @return array<string, mixed>
 */
function msgStartBody(User $recipient, array $overrides = []): array
{
    return array_replace_recursive([
        'recipient' => $recipient->username,
        'message' => ['type' => 'text', 'body' => 'Servus, ist das noch der originale RB26?'],
        'client_id' => (string) Str::uuid(),
    ], $overrides);
}
