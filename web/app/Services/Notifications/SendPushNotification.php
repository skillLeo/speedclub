<?php

namespace App\Services\Notifications;

use App\Enums\DevicePlatform;
use App\Models\Notification;
use App\Models\PushToken;
use App\Models\User;
use Illuminate\Contracts\Queue\ShouldQueue;
use Illuminate\Foundation\Queue\Queueable;

/**
 * The push of one notification row to every app install of its recipient, through the cron queue (05_ARCHITECTURE §11: only message
 * pushes go after the response). Carries the row's id only. Everything is decided again when it runs, as the queue may lag: push still
 * on, the type's switch still on, outside quiet hours, the row still shown in HOME-02. The text is rendered then, in the recipient's
 * language, from the actors and the build the recipient may see then. The payload is {type, notification_id, path}: the app opens
 * `path` and marks the row read by its id; never message content (ADR-035). A single try: a retry after a half-sent batch would push
 * twice.
 */
class SendPushNotification implements ShouldQueue
{
    use Queueable;

    public int $tries = 1;

    public int $timeout = 40;

    public function __construct(public readonly string $notificationId) {}

    public function handle(ExpoPush $push, NotificationFeed $feed, NotificationTexts $texts): void
    {
        $row = Notification::query()->with('recipient')->find($this->notificationId);
        $recipient = $row?->recipient;

        if (! $row instanceof Notification || ! $recipient instanceof User || $recipient->trashed() || ! $push->enabled()) {
            return;
        }

        $preference = $row->type->pushPreference();
        $wanted = $preference === null ? $row->type->alwaysPushes() : NotificationPrefs::wantsPush($recipient, $preference);

        if (! $wanted || (! $row->type->isUrgent() && QuietHours::active($recipient))) {
            return;
        }

        $shown = $feed->find($recipient, $row->id);
        $text = $shown instanceof Notification ? $texts->push($shown, $recipient) : null;

        if (! $shown instanceof Notification || $text === null) {
            return;
        }

        $tokens = PushToken::query()
            ->where('user_id', $recipient->id)
            ->whereIn('platform', [DevicePlatform::Ios->value, DevicePlatform::Android->value])
            ->get();

        if ($tokens->isNotEmpty()) {
            $push->send($tokens, $text['title'], $text['body'], [
                'type' => $shown->type->value,
                'notification_id' => $shown->id,
                'path' => $texts->path($shown),
            ]);
        }
    }
}
