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

    /**
     * Rows of a type with actors leave the list when none of their actors may be shown any more (blocked, gone, suspended).
     */
    public function hasActors(): bool
    {
        return match ($this) {
            self::NewFollower, self::FollowedPublished => true,
            self::BuildSaved, self::Security, self::ModerationDecision, self::ReportDecided, self::QrMilestone, self::HuAuReminder, self::CatalogRequest, self::SupportReply => false,
        };
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
            self::NewFollower, self::FollowedPublished, self::BuildSaved, self::QrMilestone, self::HuAuReminder => $this->value,
            self::Security, self::ModerationDecision, self::ReportDecided, self::CatalogRequest, self::SupportReply => null,
        };
    }
}
