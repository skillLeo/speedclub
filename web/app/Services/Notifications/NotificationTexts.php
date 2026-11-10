<?php

namespace App\Services\Notifications;

use App\Enums\NotificationType;
use App\Models\Notification;
use App\Models\User;
use App\Models\Vehicle;
use App\Services\Content\MessageTemplates;
use App\Services\Garage\VehiclePresenter;
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
            NotificationType::Security, NotificationType::ReportDecided => null,
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
            NotificationType::Security => '/notifications',
            NotificationType::ModerationDecision, NotificationType::ReportDecided => is_string($row->data['decision_id'] ?? null) ? '/decision/'.$row->data['decision_id'] : '/notifications',
            NotificationType::QrMilestone => $vehicle !== null ? '/qr/'.$vehicle->id : '/notifications',
            NotificationType::HuAuReminder => $vehicle !== null ? '/garage/'.$vehicle->id.'/specs' : '/notifications',
            NotificationType::CatalogRequest => $vehicle !== null ? '/garage/'.$vehicle->id : '/notifications',
            // SET-15 thread.
            NotificationType::SupportReply => is_string($row->data['ticket_id'] ?? null) ? '/settings/help/requests/'.$row->data['ticket_id'] : '/settings/help/requests',
        };
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

    private function vehicle(Notification $row): ?Vehicle
    {
        $vehicle = $row->relationLoaded('vehicle') ? $row->getRelation('vehicle') : null;

        return $vehicle instanceof Vehicle ? $vehicle : null;
    }
}
