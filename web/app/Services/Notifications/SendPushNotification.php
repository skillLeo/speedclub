<?php

namespace App\Services\Notifications;

use App\Enums\DevicePlatform;
use App\Enums\NotificationType;
use App\Enums\SecurityNotice;
use App\Models\Notification;
use App\Models\PushSubscription;
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
 *
 * M4.15 (ADR-452): the same text also goes to the member web's browsers (WebPush), under the type's `web_push` switch instead of
 * `push`; quiet hours, urgency and the login alert's exception apply alike. The browser opens the row's path as its /app route; the
 * tag is the row's id, so a grouped row that pushes again replaces its notification. A login alert skips the browsers subscribed after
 * it, as the app skips the new install.
 */
class SendPushNotification implements ShouldQueue
{
    use Queueable;

    public int $tries = 1;

    public int $timeout = 40;

    /**
     * @param  string  $exceptInstallId  an install id whose push tokens are left out ('' for none): the new device of a login alert (09 §8.4)
     */
    public function __construct(public readonly string $notificationId, public readonly string $exceptInstallId = '') {}

    public function handle(ExpoPush $push, NotificationFeed $feed, NotificationTexts $texts, WebPush $webPush): void
    {
        $row = Notification::query()->with('recipient')->find($this->notificationId);
        $recipient = $row?->recipient;

        if (! $row instanceof Notification || ! $recipient instanceof User || $recipient->trashed()) {
            return;
        }

        $preference = $row->type->pushPreference();
        // M4.7 (09 §8.4): the login alert pushes, whatever the switches and quiet hours, like every security notice mails.
        $loginAlert = $row->type === NotificationType::Security && ($row->data['event'] ?? null) === SecurityNotice::NewDevice->value;
        $wants = fn (bool $switch): bool => $loginAlert || ($preference === null ? $row->type->alwaysPushes() : $switch);
        $native = $push->enabled() && $wants($preference !== null && NotificationPrefs::wantsPush($recipient, $preference));
        $web = $webPush->enabled() && $wants($preference !== null && NotificationPrefs::wantsWebPush($recipient, $preference));

        if ((! $native && ! $web) || (! $loginAlert && ! $row->type->isUrgent() && QuietHours::active($recipient))) {
            return;
        }

        $shown = $feed->find($recipient, $row->id);
        $text = $shown instanceof Notification ? $texts->push($shown, $recipient) : null;

        if (! $shown instanceof Notification || $text === null) {
            return;
        }

        $tokens = $native ? PushToken::query()
            ->where('user_id', $recipient->id)
            ->whereIn('platform', [DevicePlatform::Ios->value, DevicePlatform::Android->value])
            ->when($this->exceptInstallId !== '', fn ($query) => $query->where(fn ($other) => $other->whereNull('device_id')->orWhere('device_id', '!=', $this->exceptInstallId)))
            ->get() : collect();

        if ($tokens->isNotEmpty()) {
            $push->send($tokens, $text['title'], $text['body'], [
                'type' => $shown->type->value,
                'notification_id' => $shown->id,
                'path' => $texts->path($shown),
                // M4.13 (09 §8.8): the stage's deterministic key; the app drops its local backup notification of the same id.
                ...($shown->type === NotificationType::MaintenanceDue && is_string($shown->data['reminder_key'] ?? null) ? ['reminder_key' => $shown->data['reminder_key']] : []),
            ]);
        }

        if ($web) {
            $subscriptions = PushSubscription::query()
                ->where('user_id', $recipient->id)
                ->when($loginAlert, fn ($query) => $query->where('created_at', '<', $row->created_at))
                ->get();

            if ($subscriptions->isNotEmpty()) {
                $webPush->send($subscriptions, $text['title'], $text['body'], $texts->path($shown), 'ntf-'.$shown->id, $texts->locale($recipient), $loginAlert || $row->type->isUrgent() ? 'high' : 'normal');
            }
        }
    }
}
