<?php

namespace App\Services\Notifications;

use App\Enums\NotificationType;
use App\Enums\SecurityNotice;
use App\Models\Event;
use App\Models\Notification;
use App\Models\User;
use App\Models\Vehicle;
use App\Services\Content\MessageTemplates;
use App\Services\Garage\VehiclePresenter;
use App\Services\Maintenance\MaintenanceTexts;
use App\Services\Privacy\OrgIdentity;
use App\Support\Units;
use Carbon\CarbonImmutable;

/**
 * Push texts and targets in the recipient's language (lang/{de,en}/notifications.php), from a row as NotificationFeed hydrates it: its
 * shown actors, the count of actors the recipient may still see and the vehicle while the recipient may see it. The in-app list renders
 * its own text from the row; e-mails have their own templates. Names are usernames, vehicles their short title; nothing a member wrote is
 * quoted, never message content (ADR-035).
 */
class NotificationTexts
{
    public function __construct(private readonly VehiclePresenter $presenter) {}

    /**
     * @return array{title: string, body: string}|null null for a type that never pushes, and when what the text names is gone (an actor
     *                                                 the recipient may no longer see, a build that went private): no push then, rather
     *                                                 than "@ folgt dir jetzt."
     */
    public function push(Notification $row, User $recipient): ?array
    {
        $locale = $this->locale($recipient);
        // ADM-33: the edited push texts of this locale (MessageTemplates).
        app(MessageTemplates::class)->apply($locale);
        $actor = $this->actor($row);
        $vehicle = $this->vehicle($row);
        $count = $row->visibleActorCount;
        $event = $this->event($row);

        $body = match ($row->type) {
            NotificationType::NewFollower => $actor === null ? null : trans_choice('notifications.new_follower', max(1, $count), [
                'name' => $actor->username,
                'count' => max(0, $count - 1),
            ], $locale),
            NotificationType::FollowedPublished => $actor === null || $vehicle === null ? null : (string) __(
                'notifications.followed_published.'.(($row->data['kind'] ?? null) === 'vehicle' ? 'vehicle' : 'update'),
                ['name' => $actor->username, 'vehicle' => $this->presenter->title($vehicle)],
                $locale,
            ),
            NotificationType::BuildSaved => $vehicle === null || $count < 1 ? null : trans_choice('notifications.build_saved', $count, [
                'count' => $count,
                'vehicle' => $this->presenter->title($vehicle),
            ], $locale),
            // M4.7 (09 §8.4): only the login alert pushes; it names the device the account was signed in on, nothing else.
            NotificationType::Security => ($row->data['event'] ?? null) === SecurityNotice::NewDevice->value
                ? (string) __('notifications.security_new_device', ['device' => is_string($row->data['device_name'] ?? null) ? $row->data['device_name'] : (string) __('mail.security.browser', [], $locale)], $locale)
                : null,
            NotificationType::ReportDecided => null,
            // M2.6: never what was decided or why, only that there is a decision to read (the statement of reasons is in SAFE-01 and the mail).
            NotificationType::ModerationDecision => (string) __('notifications.moderation_decision', [], $locale),
            // M2.7 [SIG]: the owner's own build, so its title is safe to name.
            NotificationType::QrMilestone => $vehicle === null ? null : (string) __('notifications.qr_milestone', [
                'count' => Units::formatNumber((int) ($row->data['milestone'] ?? 0), $locale, 0),
                'vehicle' => $this->presenter->title($vehicle),
            ], $locale),
            NotificationType::HuAuReminder => $vehicle === null ? null : (string) __('notifications.hu_au_reminder', [
                'vehicle' => $this->presenter->title($vehicle),
                'month' => self::month(is_string($row->data['due'] ?? null) ? $row->data['due'] : null, $locale),
            ], $locale),
            // M3.3: in-app only (no push switch); the text exists for a client that asks.
            NotificationType::CatalogRequest => (string) __('notifications.catalog_request.'.(($row->data['outcome'] ?? null) === 'accepted' ? 'accepted' : 'rejected'), [
                'vehicle' => $vehicle === null ? (string) ($row->data['requested'] ?? '') : $this->presenter->title($vehicle),
            ], $locale),
            // In-app only (no push row in 02 §7); names the reference, never the team's text.
            NotificationType::SupportReply => (string) __('notifications.support_reply', ['reference' => (string) ($row->data['reference'] ?? '')], $locale),
            // M4.11: the member and the build, never a reaction count beyond the row's own actors, never a text.
            NotificationType::Reaction => $actor === null || $vehicle === null ? null : trans_choice('notifications.reaction.'.(($row->data['target'] ?? null) === 'vehicle' ? 'vehicle' : 'build_update'), max(1, $count), [
                'name' => $actor->username,
                'count' => max(0, $count - 1),
                'vehicle' => $this->presenter->title($vehicle),
            ], $locale),
            NotificationType::Mention => $actor === null || $vehicle === null ? null : (string) __('notifications.mention.'.(is_string($row->data['comment_id'] ?? null) ? 'comment' : 'update'), [
                'name' => $actor->username,
                'vehicle' => $this->presenter->title($vehicle),
            ], $locale),
            NotificationType::Comment => $actor === null || $vehicle === null ? null : (($row->data['reply'] ?? false) === true
                ? (string) __('notifications.comment.reply', ['name' => $actor->username, 'vehicle' => $this->presenter->title($vehicle)], $locale)
                : trans_choice('notifications.comment.update', max(1, $count), ['name' => $actor->username, 'count' => max(0, $count - 1), 'vehicle' => $this->presenter->title($vehicle)], $locale)),
            NotificationType::VehicleFollower => $actor === null || $vehicle === null ? null : trans_choice('notifications.vehicle_follower', max(1, $count), [
                'name' => $actor->username,
                'count' => max(0, $count - 1),
                'vehicle' => $this->presenter->title($vehicle),
            ], $locale),
            // M4.12: the event's title (the organiser's public text) and its start; never an update's text or a rejection reason.
            NotificationType::EventReview => $event === null && ($row->data['outcome'] ?? null) === 'approved' ? null : (string) __('notifications.event_review.'.(($row->data['outcome'] ?? null) === 'approved' ? 'approved' : 'rejected'), ['title' => $this->eventTitle($row, $event)], $locale),
            NotificationType::EventPromoted => $event === null ? null : (string) __('notifications.event_promoted', ['title' => $event->title], $locale),
            NotificationType::EventReminder => $event === null ? null : (string) __('notifications.event_reminder.'.(($row->data['kind'] ?? null) === '2h' ? '2h' : '24h'), [
                'title' => $event->title,
                'time' => $event->starts_at?->setTimezone(config()->string('speedclub.notifications.timezone'))->format('H:i') ?? '',
            ], $locale),
            NotificationType::EventUpdate => $event === null ? null : (string) __('notifications.event_update.'.(($row->data['kind'] ?? null) === 'changed' ? 'changed' : 'update'), ['title' => $event->title], $locale),
            NotificationType::EventCancelled => $event === null ? null : (string) __('notifications.event_cancelled', ['title' => $event->title], $locale),
            // M4.13: the owner's own vehicle and item (MaintenanceTexts), in their distance unit.
            NotificationType::MaintenanceDue => $vehicle === null ? null : app(MaintenanceTexts::class)->sentence($row->data ?? [], $this->presenter->title($vehicle), $recipient, $locale),
        };

        return $body === null ? null : ['title' => (string) __('notifications.title', [], $locale), 'body' => $body];
    }

    /**
     * Where a tap leads, an app path: the one new follower's profile, the build, else HOME-02.
     */
    public function path(Notification $row): string
    {
        $actor = $this->actor($row);
        $vehicle = $this->vehicle($row);

        return match ($row->type) {
            NotificationType::NewFollower => $actor !== null && $row->visibleActorCount === 1 ? '/u/'.$actor->username : '/notifications',
            NotificationType::FollowedPublished, NotificationType::BuildSaved => $vehicle !== null ? '/v/'.$vehicle->slug : '/notifications',
            // M4.7: a login alert opens SET-21 at its row.
            NotificationType::Security => is_string($row->data['security_event_id'] ?? null) ? '/settings/security/activity?event='.$row->data['security_event_id'] : '/notifications',
            NotificationType::ModerationDecision, NotificationType::ReportDecided => is_string($row->data['decision_id'] ?? null) ? '/decision/'.$row->data['decision_id'] : '/notifications',
            NotificationType::QrMilestone => $vehicle !== null ? '/qr/'.$vehicle->id : '/notifications',
            NotificationType::HuAuReminder => $vehicle !== null ? '/garage/'.$vehicle->id.'/specs' : '/notifications',
            NotificationType::CatalogRequest => $vehicle !== null ? '/garage/'.$vehicle->id : '/notifications',
            // SET-15 thread.
            NotificationType::SupportReply => is_string($row->data['ticket_id'] ?? null) ? '/settings/help/requests/'.$row->data['ticket_id'] : '/settings/help/requests',
            // M4.11: VEH-05 while the update is still shown, else the build, else HOME-02.
            NotificationType::Reaction, NotificationType::Mention, NotificationType::Comment => $this->updatePath($row, $vehicle),
            NotificationType::VehicleFollower => $vehicle !== null ? '/v/'.$vehicle->slug : '/notifications',
            // M4.12: EVT-02 while the reader may see the event; the organiser's own (even rejected) event opens EVT-05 "Organisiert".
            // M4.13: MNT-01 of the vehicle, at the item.
            NotificationType::MaintenanceDue => $vehicle !== null ? '/garage/'.$vehicle->id.'/maintenance'.(is_string($row->data['item_id'] ?? null) ? '?item='.$row->data['item_id'] : '') : '/notifications',
            NotificationType::EventReview, NotificationType::EventPromoted, NotificationType::EventReminder, NotificationType::EventUpdate, NotificationType::EventCancelled => ($event = $this->event($row)) !== null
                ? '/events/'.$event->slug
                : ($row->type === NotificationType::EventReview ? '/events/mine?tab=organised' : '/notifications'),
        };
    }

    private function updatePath(Notification $row, ?Vehicle $vehicle): string
    {
        $update = $row->data['update_id'] ?? null;

        if ($vehicle !== null && is_string($update) && in_array($update, $row->visibleUpdateIds, true)) {
            return '/v/'.$vehicle->slug.'/updates/'.$update.(is_string($row->data['comment_id'] ?? null) ? '?comment='.$row->data['comment_id'] : '');
        }

        return $vehicle !== null ? '/v/'.$vehicle->slug : '/notifications';
    }

    /**
     * "März 2027" / "March 2027" from "2027-03"; the raw value when it is not a month.
     */
    public static function month(?string $due, string $locale): string
    {
        if ($due === null || preg_match('/^\d{4}-\d{2}$/', $due) !== 1) {
            return (string) $due;
        }

        $month = CarbonImmutable::createFromFormat('!Y-m', $due);

        return $month instanceof CarbonImmutable ? $month->settings(['locale' => $locale])->isoFormat('MMMM YYYY') : $due;
    }

    public function locale(User $user): string
    {
        // ADR-239: a member without a locale of their own gets the org's default locale.
        return app(OrgIdentity::class)->localeOr($user->getAttribute('locale'));
    }

    private function actor(Notification $row): ?User
    {
        $actors = $row->relationLoaded('shownActors') ? $row->getRelation('shownActors') : collect();
        $actor = $actors->first();

        return $actor instanceof User && is_string($actor->username) ? $actor : null;
    }

    private function event(Notification $row): ?Event
    {
        $event = $row->relationLoaded('event') ? $row->getRelation('event') : null;

        return $event instanceof Event ? $event : null;
    }

    /**
     * A rejected event is only the organiser's: its title is named from the row's event (loaded even when not shown) or left general.
     */
    private function eventTitle(Notification $row, ?Event $event): string
    {
        if ($event !== null) {
            return $event->title;
        }

        $id = $row->data['event_id'] ?? null;
        $title = is_string($id) ? Event::query()->whereKey($id)->value('title') : null;

        return is_string($title) ? $title : '';
    }

    private function vehicle(Notification $row): ?Vehicle
    {
        $vehicle = $row->relationLoaded('vehicle') ? $row->getRelation('vehicle') : null;

        return $vehicle instanceof Vehicle ? $vehicle : null;
    }
}
