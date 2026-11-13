<?php

namespace App\Services\Messaging;

use App\Enums\DevicePlatform;
use App\Enums\MessageType;
use App\Models\ConversationParticipant;
use App\Models\Message;
use App\Models\PushSubscription;
use App\Models\PushToken;
use App\Models\User;
use App\Services\Notifications\ExpoPush;
use App\Services\Notifications\NotificationPrefs;
use App\Services\Notifications\NotificationTexts;
use App\Services\Notifications\Notifier;
use App\Services\Notifications\QuietHours;
use App\Services\Notifications\WebPush;
use Illuminate\Contracts\Queue\ShouldQueue;
use Illuminate\Foundation\Queue\Queueable;
use Illuminate\Support\Facades\Cache;

/**
 * The push of one message, run after the response (dispatchAfterResponse; ADR-010). Carries ids only and decides everything again: push
 * on, the type's switch, the conversation not muted and not deleted for the recipient, the message still there, visible and unread, the
 * sender still someone the recipient may see, outside quiet hours, and at most one push per conversation within push_cooldown_seconds.
 *
 * Text: "Neue Nachricht von @name" ("@name möchte dir schreiben" for a request). Only a member who turned message previews on gets the
 * start of a text ("Foto" / "Fahrzeug" for the others), never for a request (ADR-035). Data: {type, notification_id: null, path}, the path
 * of MSG-02 or MSG-04.
 *
 * M4.15 (ADR-452): the same text goes to the member web's browsers under the type's `web_push` switch, tagged per conversation so a
 * newer message replaces the older notification, opening the thread's /app route. The cooldown is shared by both channels.
 */
class SendMessagePush implements ShouldQueue
{
    use Queueable;

    public int $tries = 1;

    // M4.15: Expo (10 s) and up to five browsers (5 s each) one after the other, inside the queue's 50 s.
    public int $timeout = 40;

    public function __construct(
        public readonly string $recipientId,
        public readonly string $senderId,
        public readonly string $conversationId,
        public readonly string $messageId,
    ) {}

    public function handle(ExpoPush $push, Conversations $conversations, Notifier $notifier, NotificationTexts $texts, WebPush $webPush): void
    {
        $recipient = User::query()->find($this->recipientId);
        $sender = User::query()->find($this->senderId);

        if ((! $push->enabled() && ! $webPush->enabled()) || ! $recipient instanceof User || ! $sender instanceof User || ! $recipient->isActive() || ! $recipient->hasVerifiedEmail()) {
            return;
        }

        $participant = ConversationParticipant::query()->where('conversation_id', $this->conversationId)->where('user_id', $recipient->id)->first();

        if (! $participant instanceof ConversationParticipant || $participant->deleted_at !== null || $participant->isMuted()) {
            return;
        }

        // A request as it stands now: one the recipient accepted since is a chat message.
        $request = $participant->isPendingRequest();
        $type = $request ? 'message_request' : 'new_message';

        $native = $push->enabled() && NotificationPrefs::wantsPush($recipient, $type);
        $web = $webPush->enabled() && NotificationPrefs::wantsWebPush($recipient, $type);

        if ((! $native && ! $web) || QuietHours::active($recipient) || ! $notifier->mayShow($recipient, $sender)) {
            return;
        }

        if ($participant->last_read_message_id !== null && strcmp($participant->last_read_message_id, $this->messageId) >= 0) {
            return;
        }

        $message = $conversations->visibleMessages($participant)->whereKey($this->messageId)->first();

        if (! $message instanceof Message) {
            return;
        }

        $cooldown = config()->integer('speedclub.messaging.push_cooldown_seconds');

        if ($cooldown > 0 && ! Cache::add('push:message:'.$this->conversationId.':'.$recipient->id, true, $cooldown)) {
            return;
        }

        $tokens = $native ? PushToken::query()
            ->where('user_id', $recipient->id)
            ->whereIn('platform', [DevicePlatform::Ios->value, DevicePlatform::Android->value])
            ->get() : collect();
        $subscriptions = $web ? PushSubscription::query()->where('user_id', $recipient->id)->get() : collect();

        if ($tokens->isEmpty() && $subscriptions->isEmpty()) {
            return;
        }

        $locale = $texts->locale($recipient);
        $name = ['name' => (string) $sender->username];
        $previews = ! $request && NotificationPrefs::for($recipient)['message_previews'];

        [$title, $body] = $previews
            ? ['@'.$sender->username, $this->preview($message, $locale)]
            : [(string) __('notifications.title', [], $locale), (string) __('messaging.push.'.$type, $name, $locale)];

        $path = $request ? '/messages/requests/'.$this->conversationId : '/messages/'.$this->conversationId;

        if ($tokens->isNotEmpty()) {
            $push->send($tokens, $title, $body, ['type' => $type, 'notification_id' => null, 'path' => $path]);
        }

        if ($subscriptions->isNotEmpty()) {
            $webPush->send($subscriptions, $title, $body, $path, 'msg-'.$this->conversationId, $locale);
        }
    }

    private function preview(Message $message, string $locale): string
    {
        return match ($message->type) {
            MessageType::Text => mb_substr((string) preg_replace('/\s+/u', ' ', trim((string) $message->body)), 0, config()->integer('speedclub.messaging.push_preview_length')),
            MessageType::Photo => (string) __('messaging.push.photo', [], $locale),
            MessageType::Vehicle => (string) __('messaging.push.vehicle', [], $locale),
        };
    }
}
