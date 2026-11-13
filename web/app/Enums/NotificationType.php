<?php

namespace App\Enums;

/**
 * The rows of the notification list (02_PRODUCT_SPEC §7). Written by App\Services\Notifications\Notifier only; later modules add their
 * types here (M2.4 messages and requests, M2.6 decisions, M2.7 QR milestones and HU/AU).
 */
enum NotificationType: string
{
    case NewFollower = 'new_follower';
    case FollowedPublished = 'followed_published';
    case BuildSaved = 'build_saved';
    case Security = 'security';
    // M2.6: a decision about the member's content or account (Art. 17 DSA). The statement of reasons goes by e-mail too (DecideCase).
    case ModerationDecision = 'moderation_decision';
    // M2.6: the outcome of a case the member reported (Art. 16(5) DSA), outcome only.
    case ReportDecided = 'report_decided';
    // M2.7 [SIG sig.qr_stats]: a vehicle's stickers reached 10, 50, 100, 500 or 1000 scans in total, once per milestone (qr:milestones).
    case QrMilestone = 'qr_milestone';
    // M2.7 [SIG sig.hu_au_reminder]: the HU/AU of a vehicle is due in 30 days, once per due date (vehicles:hu-au-reminders).
    case HuAuReminder = 'hu_au_reminder';
    // M3.3: the member's catalogue request ("Nicht gefunden?") was taken into the catalogue (their vehicle now points at the entry) or
    // declined with a reason. In-app only.
    case CatalogRequest = 'catalog_request';
    // Phase 3 (SET-15, ADM-26): the team answered one of the member's support requests. In-app only: 02_PRODUCT_SPEC §7 has no push
    // row for it (like catalog_request). One row per ticket; a further answer moves it up and makes it unread again.
    case SupportReply = 'support_reply';
    // M4.11 (09 §8.17): members reacted to the recipient's build or build update; one row per item and day, the push at most once an hour.
    case Reaction = 'reaction';
    // M4.11: a member mentioned the recipient in a build update or a comment; one row per item.
    case Mention = 'mention';
    // M4.11 [build_comments]: comments on the recipient's build update, or replies to the recipient's comment; one row per update and day.
    case Comment = 'comment';
    // M4.11 (09 §8.6): members started following one of the recipient's builds; one row per build and day.
    case VehicleFollower = 'vehicle_follower';
    // M4.12 (09 §8.17): staff approved or rejected the organiser's event (ADM-53); one row per submission.
    case EventReview = 'event_review';
    // M4.12: a spot freed up and the member moved from the waitlist to "going"; one row per event.
    case EventPromoted = 'event_promoted';
    // M4.12: the event starts in 24 h or 2 h (events:reminders); one row per event and reminder, to going members.
    case EventReminder = 'event_reminder';
    // M4.12: the organiser posted an update to the attendees (EVT-06), or changed the time or place; one row per update.
    case EventUpdate = 'event_update';
    // M4.12: the event was cancelled (by its organiser or staff); one row per event, to everybody with an answer.
    case EventCancelled = 'event_cancelled';
    // M4.13 (09 §8.8, §8.17): a maintenance item of the recipient's vehicle is due (a lead time reached, or the mileage within 1,000 km);
    // one row per reminder stage, its group_key the stage's deterministic reminder key (maintenance:reminders). SET-09 "Fälligkeiten".
    case MaintenanceDue = 'maintenance_due';
    // M4.14 (09 §8.10): staff verified, rejected, suspended or reinstated the recipient's business (ADM-55/56); one row per decision.
    // In-app only, like catalog_request: SET-09 has no switch for it.
    case BusinessReview = 'business_review';
    // M4.14 (09 §8.10): a portfolio tag ("Eingebaut von") waits for the recipient's confirmation (to the business owner, or to the build's
    // owner when the business asked), or the other side decided; one row per tag and state. In-app only.
    case BusinessTag = 'business_tag';

    /**
     * M4.8 HOME-02 chips (`?category=`): Builds (own and followed builds, due dates), Sozial (people), Treffen, System (account, safety,
     * support).
     */
    public function category(): string
    {
        return match ($this) {
            self::FollowedPublished, self::BuildSaved, self::QrMilestone, self::HuAuReminder, self::CatalogRequest, self::MaintenanceDue, self::BusinessTag => 'builds',
            self::NewFollower, self::Reaction, self::Mention, self::Comment, self::VehicleFollower => 'social',
            self::EventReview, self::EventPromoted, self::EventReminder, self::EventUpdate, self::EventCancelled => 'events',
            self::Security, self::ModerationDecision, self::ReportDecided, self::SupportReply, self::BusinessReview => 'system',
        };
    }

    /**
     * @return list<string> the type values of a category
     */
    public static function inCategory(string $category): array
    {
        return array_values(array_map(fn (self $type): string => $type->value, array_filter(self::cases(), fn (self $type): bool => $type->category() === $category)));
    }

    /**
     * Rows of a type with actors leave the list when none of their actors may be shown any more (blocked, gone, suspended).
     */
    public function hasActors(): bool
    {
        return match ($this) {
            self::NewFollower, self::FollowedPublished, self::Reaction, self::Mention, self::Comment, self::VehicleFollower => true,
            self::BuildSaved, self::Security, self::ModerationDecision, self::ReportDecided, self::QrMilestone, self::HuAuReminder, self::CatalogRequest, self::SupportReply,
            self::EventReview, self::EventPromoted, self::EventReminder, self::EventUpdate, self::EventCancelled, self::MaintenanceDue,
            self::BusinessReview, self::BusinessTag => false,
        };
    }

    /**
     * At most one push of this type per recipient within this many minutes, across all its rows (09 §8.17: reactions batched, at most one
     * push an hour). Null: only the per-row cooldown applies.
     */
    public function pushThrottleMinutes(): ?int
    {
        return $this === self::Reaction ? 60 : null;
    }

    /**
     * Urgent pushes go out during quiet hours too (ADR-192): the moderation decision (M2.6); the appeal result joins it in Phase 3.
     */
    public function isUrgent(): bool
    {
        return $this === self::ModerationDecision;
    }

    /**
     * Pushes without a switch in SET-09 (02_PRODUCT_SPEC §7: the moderation decision is "on" and mandatory, like its e-mail).
     */
    public function alwaysPushes(): bool
    {
        return $this === self::ModerationDecision;
    }

    /**
     * The key of notification_prefs.types that switches its push, or null when the type never pushes.
     */
    public function pushPreference(): ?string
    {
        return match ($this) {
            self::NewFollower, self::FollowedPublished, self::BuildSaved, self::QrMilestone, self::HuAuReminder, self::Reaction, self::Mention, self::Comment, self::VehicleFollower => $this->value,
            // M4.12: one switch for the reminders (push, and e-mail when chosen), one for everything else about an event.
            self::EventReminder => 'event_reminder',
            self::EventReview, self::EventPromoted, self::EventUpdate, self::EventCancelled => 'event_update',
            // M4.13: SET-09 has one row "Fälligkeiten" for every maintenance reminder, the HU/AU's switch since M2.7 (push, e-mail).
            self::MaintenanceDue => 'hu_au_reminder',
            self::Security, self::ModerationDecision, self::ReportDecided, self::CatalogRequest, self::SupportReply, self::BusinessReview, self::BusinessTag => null,
        };
    }
}
