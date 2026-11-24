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
    // SEC-414-01 (09 §8.10 "invited staff"): team membership is an invitation. To the invited member: a business invited them
    // (state invited) or removed them from its team (removed); to the business owner: the member accepted, declined or left. One row per
    // invitation (or membership) and state; a withdrawn invitation takes its row away. In-app only.
    case BusinessInvite = 'business_invite';
    // M5.9b STREET DEX (m5.9b contract §4): the owner's car was spotted. One row per car and Europe/Berlin day, refreshed by the 3-hourly
    // dex:spot-alerts job with the day's count and, where allowed, its cities ("Dein EK9 wurde heute 4-mal in Düsseldorf gespottet.").
    // Never who spotted it. SET-09 "Spots"; a gift social type (App\Services\Notifications\SocialPushLimiter: one push a day).
    case SpotAlert = 'spot_alert';
    // M5.9d (m5.9d contract §2, §7): the member earned a badge; one row per badge. SET-09 "Abzeichen" (push off by default); a gift social
    // type (one push a day across them). The app's unlock toast reads GET me/badges?unseen=1.
    case BadgeUnlocked = 'badge_unlocked';
    // M5.9d (contract §3): today's Car of the Day, only to members who switched the opt-in "Car of the Day" on (default off); a gift
    // social type. One row per day.
    case CarOfTheDay = 'car_of_the_day';
    // M5.9d (contract §3): the member's own car is today's Car of the Day; always in-app, push unless switched off (default on). Not one
    // of the limited social types: it comes once in 180 days at most and is about the member's own build.
    case CarOfTheDayOwner = 'car_of_the_day_owner';
    // M5.9d (contract §5): somebody activated an account with one of the member's invite codes; one row per code. SET-09 "Einladungen"
    // (push on); a gift social type.
    case InviteAccepted = 'invite_accepted';
    // M5.8 Forum (m5.8-contract §5): replies in a thread the recipient wrote or subscribed to, or to the recipient's own post; one row per
    // thread and Berlin day with every replier of that day. SET-09 "Forum".
    case ForumReply = 'forum_reply';
    // M5.8: a member mentioned the recipient in a forum post; one row per post. SET-09 "Forum".
    case ForumMention = 'forum_mention';
    // M5.8: the thread's author marked the recipient's reply as the solution ("deine Antwort wurde als Lösung markiert"); one row per
    // post. SET-09 "Forum".
    case ForumSolved = 'forum_solved';
    // M5.6 (m5.6-contract §4.6): attendees' photos wait for the organiser's approval; one row per event and Berlin day with the number
    // waiting, pushed once a day at most (the event_update switch). To the organiser.
    case EventGalleryPending = 'event_gallery_pending';
    // M5.6: the organiser approved or rejected the recipient's gallery photo; one row per photo. In-app only, never a push (10 §16).
    case EventPhotoDecided = 'event_photo_decided';
    // M5.6 (contract §6): new public meets around the member's SET-11 region, weekly (Thursday evening), opt-in, off by default; one row
    // per ISO week. SET-09 "Treffen in deiner Nähe"; a gift social type (SocialPushLimiter: one push a day, never 22–08).
    case EventNearby = 'event_nearby';
    // M5.7 (10 §6.2, m5.7-contract §4.2): a planned mod's target month arrived: "Ist das KW V3 schon verbaut? Trag es ein." One row per mod
    // and target month, at most one per owner in 7 days (PlanDuePrompts). SET-09 "Build-Erinnerungen"; an engagement type (3 a week).
    case PlanDue = 'plan_due';
    // M5.7 (10 §6.3, m5.7-contract §6): the Sunday recap of the member's week; one row per ISO week, none when nothing happened
    // (WeeklyRecaps). SET-09 "Wochenrückblick"; an engagement type.
    case WeeklyRecap = 'weekly_recap';
    // R4-2.3 Crews (contract-crews.md §5): a join request waits (to the founder and admins), the member's request was approved, or a
    // crew invited the member. One row per request or invitation and state; a decided or withdrawn one takes its row away. In-app only,
    // never "left" or "declined" (no guilt notifications).
    case Crew = 'crew';

    /**
     * M4.8 HOME-02 chips (`?category=`): Builds (own and followed builds, due dates), Sozial (people), Treffen, System (account, safety,
     * support).
     */
    public function category(): string
    {
        return match ($this) {
            self::FollowedPublished, self::BuildSaved, self::QrMilestone, self::HuAuReminder, self::CatalogRequest, self::MaintenanceDue, self::BusinessTag, self::CarOfTheDay, self::CarOfTheDayOwner, self::PlanDue, self::WeeklyRecap => 'builds',
            self::NewFollower, self::Reaction, self::Mention, self::Comment, self::VehicleFollower, self::SpotAlert, self::BadgeUnlocked, self::InviteAccepted, self::ForumReply, self::ForumMention, self::ForumSolved, self::Crew => 'social',
            self::EventReview, self::EventPromoted, self::EventReminder, self::EventUpdate, self::EventCancelled, self::EventGalleryPending, self::EventPhotoDecided, self::EventNearby => 'events',
            self::Security, self::ModerationDecision, self::ReportDecided, self::SupportReply, self::BusinessReview, self::BusinessInvite => 'system',
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
            self::NewFollower, self::FollowedPublished, self::Reaction, self::Mention, self::Comment, self::VehicleFollower, self::ForumReply, self::ForumMention => true,
            self::BuildSaved, self::Security, self::ModerationDecision, self::ReportDecided, self::QrMilestone, self::HuAuReminder, self::CatalogRequest, self::SupportReply,
            self::EventReview, self::EventPromoted, self::EventReminder, self::EventUpdate, self::EventCancelled, self::MaintenanceDue,
            self::BusinessReview, self::BusinessTag, self::BusinessInvite, self::SpotAlert, self::BadgeUnlocked, self::CarOfTheDay, self::CarOfTheDayOwner, self::InviteAccepted, self::ForumSolved,
            self::EventGalleryPending, self::EventPhotoDecided, self::EventNearby, self::PlanDue, self::WeeklyRecap, self::Crew => false,
        };
    }

    /**
     * At most one push of this type per recipient within this many minutes, across all its rows (09 §8.17: reactions batched, at most one
     * push an hour). Null: only the per-row cooldown applies.
     */
    public function pushThrottleMinutes(): ?int
    {
        // M5.8: forum replies push at most once every 30 minutes across all their threads.
        return match ($this) {
            self::Reaction => 60,
            self::ForumReply => 30,
            default => null,
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
            self::NewFollower, self::FollowedPublished, self::BuildSaved, self::QrMilestone, self::HuAuReminder, self::Reaction, self::Mention, self::Comment, self::VehicleFollower => $this->value,
            // M4.12: one switch for the reminders (push, and e-mail when chosen), one for everything else about an event.
            self::EventReminder => 'event_reminder',
            // M5.6: the organiser's photo queue counts as news about their event.
            self::EventReview, self::EventPromoted, self::EventUpdate, self::EventCancelled, self::EventGalleryPending => 'event_update',
            // M5.6: the weekly "Neue Treffen in deiner Nähe", its own opt-in switch.
            self::EventNearby => 'event_nearby',
            // M4.13: SET-09 has one row "Fälligkeiten" for every maintenance reminder, the HU/AU's switch since M2.7 (push, e-mail).
            self::MaintenanceDue => 'hu_au_reminder',
            self::SpotAlert => 'spot_alert',
            // M5.9d: each its own SET-09 switch.
            self::BadgeUnlocked => 'badge_unlocked',
            self::CarOfTheDay => 'car_of_the_day',
            self::CarOfTheDayOwner => 'car_of_the_day_owner',
            self::InviteAccepted => 'invite_accepted',
            // M5.8: SET-09 "Forum", one switch each.
            self::ForumReply => 'forum_reply',
            self::ForumMention => 'forum_mention',
            self::ForumSolved => 'forum_solved',
            // M5.7: SET-09 "Build-Erinnerungen" and "Wochenrückblick".
            self::PlanDue => 'plan_due',
            self::WeeklyRecap => 'weekly_recap',
            self::Security, self::ModerationDecision, self::ReportDecided, self::CatalogRequest, self::SupportReply, self::BusinessReview, self::BusinessTag, self::BusinessInvite,
            // M5.6: in-app only.
            self::EventPhotoDecided,
            // R4-2.3: in-app only, like business_invite.
            self::Crew => null,
        };
    }
}
