<?php

namespace App\Services\Notifications;

use App\Actions\Support\CreateSupportTicket;
use App\Enums\MemberSecurityEvent;
use App\Enums\NotificationType;
use App\Enums\SecurityNotice;
use App\Mail\EventReminderMail;
use App\Mail\HuAuReminderMail;
use App\Mail\MaintenanceDueMail;
use App\Mail\SecurityNoticeMail;
use App\Models\BuildUpdate;
use App\Models\CatalogRequest;
use App\Models\Comment;
use App\Models\Decision;
use App\Models\Event;
use App\Models\EventUpdate;
use App\Models\MaintenanceItem;
use App\Models\Notification;
use App\Models\PushToken;
use App\Models\SupportTicket;
use App\Models\User;
use App\Models\Vehicle;
use App\Services\Auth\AuthMailer;
use App\Services\Garage\VehiclePresenter;
use App\Services\Maintenance\MaintenanceTexts;
use App\Services\Security\SecureAccountLinks;
use App\Support\Security\SecurityAlert;
use Carbon\CarbonImmutable;
use Closure;
use Illuminate\Support\Facades\DB;

/**
 * The one writer of notifications (02_PRODUCT_SPEC §7, M2.2). Per type it decides the in-app row, the push and the e-mail from the matrix,
 * the member's notification_prefs, quiet hours and blocks:
 *
 * - nothing from a member the recipient blocked or who blocked the recipient, from a member nobody may see (unverified, suspended,
 *   deactivated) or from the recipient themselves; nothing to a recipient who cannot use the app (deactivated, suspended, unverified),
 *   apart from security rows and mails;
 * - grouped types keep one row per group_key and recipient: a new actor joins the row, which moves up and is unread again;
 * - push only when the type's switch is on, outside quiet hours (urgent types excepted, none yet), at most once per group within
 *   group_push_cooldown_minutes, and only while speedclub.push.enabled is on. The row is written either way.
 *
 * Later modules add their types here: M2.4 messages and requests, M2.6 decisions (urgent), M2.7 QR milestones and HU/AU.
 */
class Notifier
{
    /** Ids kept in a followed_published row, newest first. */
    private const MAX_IDS = 20;

    public function __construct(
        private readonly AuthMailer $mailer,
        private readonly ExpoPush $push,
    ) {}

    /**
     * "lukas.sc und 3 weitere folgen dir jetzt": one row per day. Following again on the same day changes nothing.
     */
    public function newFollower(User $recipient, User $follower): ?Notification
    {
        return $this->grouped(NotificationType::NewFollower, $recipient, $follower, 'new_follower:'.$this->day(), null, fn (array $data): array => $data);
    }

    /**
     * A followed member published a build ($update null) or posted a build update: one row per member and day ($day, Y-m-d in Berlin,
     * by default today).
     */
    public function followedPublished(User $recipient, User $actor, Vehicle $vehicle, ?BuildUpdate $update, ?string $day = null): ?Notification
    {
        return $this->grouped(
            NotificationType::FollowedPublished,
            $recipient,
            $actor,
            // The day of the publication, passed by the job: a slice retried after midnight in Berlin joins the same group.
            'followed_published:'.$actor->id.':'.($day ?? $this->day()),
            $vehicle,
            function (array $data) use ($vehicle, $update): array {
                $vehicles = $this->ids($data['vehicle_ids'] ?? [], $vehicle->id);
                $updates = $update === null ? $this->ids($data['update_ids'] ?? [], null) : $this->ids($data['update_ids'] ?? [], (string) $update->getKey());
                $published = $update === null ? $this->ids($data['published_ids'] ?? [], $vehicle->id) : $this->ids($data['published_ids'] ?? [], null);

                return [
                    'kind' => $update === null ? 'vehicle' : 'update',
                    'update_id' => $update === null ? null : (string) $update->getKey(),
                    'vehicle_ids' => $vehicles,
                    'update_ids' => $updates,
                    'published_ids' => $published,
                ];
            },
        );
    }

    /**
     * M4.11 (09 §8.17): $actor reacted to the owner's build ($update null) or build update. One row per item and Berlin day, with every
     * member who reacted that day; the reaction itself is not in the row (the owner reads it on the list). Push at most once an hour
     * across all reaction rows (NotificationType::pushThrottleMinutes).
     */
    public function reaction(User $owner, User $actor, Vehicle $vehicle, ?BuildUpdate $update): ?Notification
    {
        $target = $update === null ? 'v:'.$vehicle->id : 'u:'.$update->getKey();

        return $this->grouped(NotificationType::Reaction, $owner, $actor, 'reaction:'.$target.':'.$this->day(), $vehicle, fn (array $data): array => [
            'target' => $update === null ? 'vehicle' : 'build_update',
            'update_id' => $update === null ? null : (string) $update->getKey(),
            'update_ids' => $update === null ? [] : [(string) $update->getKey()],
        ]);
    }

    /**
     * M4.11: $author mentioned $recipient in a build update ($comment null) or a comment on one. One row per text: an edit that names
     * the member again changes nothing (Mentions::sync only returns new mentions).
     */
    public function mention(User $recipient, User $author, Vehicle $vehicle, BuildUpdate $update, ?Comment $comment = null): ?Notification
    {
        $key = $comment === null ? 'u:'.$update->getKey() : 'c:'.$comment->getKey();

        return $this->grouped(NotificationType::Mention, $recipient, $author, 'mention:'.$key, $vehicle, fn (array $data): array => [
            'update_id' => (string) $update->getKey(),
            'update_ids' => [(string) $update->getKey()],
            'comment_id' => $comment === null ? null : (string) $comment->getKey(),
        ]);
    }

    /**
     * M4.11 [build_comments]: comments on the recipient's build update, or ($reply) replies to the recipient's comment. One row per
     * update, kind and Berlin day, with every commenter of that day; never the text.
     */
    public function comment(User $recipient, User $actor, Vehicle $vehicle, BuildUpdate $update, Comment $comment, bool $reply): ?Notification
    {
        return $this->grouped(
            NotificationType::Comment,
            $recipient,
            $actor,
            'comment:'.$update->getKey().':'.($reply ? 'reply' : 'update').':'.$this->day(),
            $vehicle,
            fn (array $data): array => [
                'update_id' => (string) $update->getKey(),
                'update_ids' => [(string) $update->getKey()],
                'comment_id' => (string) $comment->getKey(),
                'reply' => $reply,
            ],
        );
    }

    /**
     * M4.11 (09 §8.6): $follower started following the owner's build. One row per build and Berlin day; never a count for anybody else.
     */
    public function vehicleFollower(User $owner, User $follower, Vehicle $vehicle): ?Notification
    {
        return $this->grouped(NotificationType::VehicleFollower, $owner, $follower, 'vehicle_follower:'.$vehicle->id.':'.$this->day(), $vehicle, fn (array $data): array => $data);
    }

    /**
     * [SIG] The weekly aggregate: how many members saved the build in an ISO week, never who. Run again with the same count, it changes
     * nothing.
     */
    public function buildSaved(User $owner, Vehicle $vehicle, int $count, string $week): ?Notification
    {
        if ($count < 1) {
            return null;
        }

        return $this->grouped(
            NotificationType::BuildSaved,
            $owner,
            null,
            'build_saved:'.$vehicle->id.':'.$week,
            $vehicle,
            fn (array $data): array => ['count' => $count, 'week' => $week],
            $count,
        );
    }

    /**
     * New device, password, e-mail or two-factor changed, deletion requested: the mandatory e-mail (after the response, ADR-130) and an
     * in-app row, whatever the preferences. Never a push. $to is the address of the mail, the member's own by default (an e-mail change
     * writes to the previous one). $variant picks a more precise mail text (SecurityNoticeMail), e.g. two-factor "enabled"; $count fills
     * :count (recovery codes left).
     *
     * M4.7 (09 §8.4): $alert adds the SET-21 row (`security_event_id` in the row), the "Das war ich nicht" link, time and approximate place
     * to the mail. A new-device notice is the one security notice that also pushes: urgent, to every install but the new one.
     */
    public function security(User $user, SecurityNotice $notice, ?string $deviceName = null, ?string $to = null, ?string $variant = null, ?int $count = null, ?SecurityAlert $alert = null): ?Notification
    {
        $locale = $user->getAttribute('locale');
        $this->mailer->sendLater($to ?? $user->email, is_string($locale) ? $locale : app()->getLocale(), new SecurityNoticeMail($notice, $deviceName, $variant, $count, $alert->secureUrl ?? $this->freshSecureUrl($user, $notice, $variant), $alert?->place, $alert?->at, $alert?->reference, $alert?->removed));

        if ($user->trashed()) {
            return null;
        }

        $row = new Notification;
        $row->forceFill([
            'type' => NotificationType::Security,
            'notifiable_type' => 'user',
            'notifiable_id' => $user->id,
            'data' => [
                'event' => $notice->value,
                'device_name' => $deviceName === null ? null : mb_substr($deviceName, 0, 100),
                ...($alert?->eventId === null ? [] : ['security_event_id' => $alert->eventId]),
            ],
            'created_at' => now(),
        ])->save();

        if ($notice === SecurityNotice::NewDevice && $this->push->enabled() && $this->reaches($user)) {
            $claimed = Notification::query()->whereKey($row->id)->whereNull('pushed_at')->toBase()->update(['pushed_at' => now()]);

            if ($claimed === 1) {
                SendPushNotification::dispatch($row->id, (string) $alert?->pushExceptInstall);
            }
        }

        return $row;
    }

    /**
     * SEC-M47-05: the password, two-factor and signed-out mails carry a fresh "Das war ich nicht" link to the change's own SET-21 row, so an
     * intruder who changed something there cannot leave the owner without one. Not for a change staff made (the variant says so).
     */
    private function freshSecureUrl(User $user, SecurityNotice $notice, ?string $variant): ?string
    {
        $types = match ($notice) {
            SecurityNotice::PasswordChanged => [MemberSecurityEvent::PasswordChanged, MemberSecurityEvent::PasswordReset],
            SecurityNotice::TwoFactorChanged => [MemberSecurityEvent::TwoFactorEnabled, MemberSecurityEvent::TwoFactorDisabled, MemberSecurityEvent::RecoveryCodesRegenerated],
            SecurityNotice::SessionsRevoked => [MemberSecurityEvent::SessionRevoked, MemberSecurityEvent::LogoutAll],
            default => [],
        };

        if ($types === [] || ($variant !== null && str_contains($variant, 'staff')) || $user->trashed()) {
            return null;
        }

        $event = $user->securityEvents()
            ->whereIn('type', $types)
            ->whereNull('secured_at')
            ->where('created_at', '>=', now()->subMinutes(10))
            ->latest('created_at')
            ->latest('id')
            ->first();

        return $event === null ? null : app(SecureAccountLinks::class)->url($user, $event);
    }

    /**
     * M2.6: a decision about the member's content or account. The in-app row and an urgent push (no SET-09 switch, quiet hours do not
     * apply, ADR-192); the mandatory e-mail with the statement of reasons is DecideCase's. Written for a suspended or unverified member
     * too: they must learn why (Art. 17 DSA). Ungrouped, details {decision_id, action}.
     */
    public function moderationDecision(User $recipient, Decision $decision): ?Notification
    {
        return $this->decisionRow(NotificationType::ModerationDecision, $recipient, $decision);
    }

    /**
     * M2.6: the outcome of a case the member reported (Art. 16(5) DSA). In-app only, outcome only: details {decision_id, outcome:
     * no_action|remove_content|measures}, never which measure (M2.6 review #2).
     */
    public function reportDecided(User $recipient, Decision $decision): ?Notification
    {
        return $this->decisionRow(NotificationType::ReportDecided, $recipient, $decision);
    }

    /**
     * M2.7 [SIG sig.qr_stats]: the vehicle's stickers reached $milestone scans in total. In-app; push only when the owner switched it on (off by
     * default, 02_PRODUCT_SPEC §7). One row per vehicle and milestone: run again, it changes nothing.
     */
    public function qrMilestone(User $owner, Vehicle $vehicle, int $milestone): ?Notification
    {
        return $this->grouped(
            NotificationType::QrMilestone,
            $owner,
            null,
            'qr_milestone:'.$vehicle->id.':'.$milestone,
            $vehicle,
            fn (array $data): array => ['milestone' => $milestone],
        );
    }

    /**
     * M2.7 [SIG sig.hu_au_reminder]: the vehicle's HU/AU is due in the month $due ("2027-03"). In-app, push (on by default) and, when the owner
     * switched it on in SET-09, an e-mail. One row per vehicle and due date.
     */
    public function huAuReminder(User $owner, Vehicle $vehicle, string $due): ?Notification
    {
        $row = $this->grouped(
            NotificationType::HuAuReminder,
            $owner,
            null,
            'hu_au_reminder:'.$vehicle->id.':'.$due,
            $vehicle,
            fn (array $data): array => ['due' => $due],
        );

        if ($row !== null && (NotificationPrefs::for($owner)['types']['hu_au_reminder']['email'] ?? false)) {
            // From the daily command, not a request: sent at once, one by one.
            $this->mailer->send($owner->email, app(NotificationTexts::class)->locale($owner), new HuAuReminderMail(app(VehiclePresenter::class)->title($vehicle), $due, (string) $vehicle->id));
        }

        return $row;
    }

    /**
     * M3.3: the member's catalogue request was taken into the catalogue ($accepted) or declined with $reason (ADM-14). In-app only (no
     * push switch in SET-09), one row per request: deciding it again changes nothing. details {outcome, requested, reason}; the vehicle
     * is the member's own.
     */
    public function catalogRequest(User $recipient, CatalogRequest $request, bool $accepted, ?string $reason = null): ?Notification
    {
        $requested = trim(implode(' ', array_filter([$request->getAttribute('make_text'), $request->getAttribute('model_text'), $request->getAttribute('generation_text')], is_string(...))));
        $vehicleId = $request->getAttribute('vehicle_id');
        $vehicle = is_string($vehicleId) ? Vehicle::query()->find($vehicleId) : null;

        return $this->grouped(
            NotificationType::CatalogRequest,
            $recipient,
            null,
            'catalog_request:'.$request->getKey(),
            $vehicle,
            fn (array $data): array => [
                'outcome' => $accepted ? 'accepted' : 'rejected',
                'requested' => $requested === '' ? null : mb_substr($requested, 0, 200),
                'reason' => $accepted || $reason === null ? null : mb_substr($reason, 0, 500),
            ],
        );
    }

    /**
     * Phase 3 (SET-15, ADM-26): the team answered the member's support request. In-app only (02_PRODUCT_SPEC §7 has no push row for it;
     * pushPreference() is null), one row per ticket: a further answer moves it up and makes it unread again. details {ticket_id,
     * reference} (replied_at only moves the row), never the answer's text. Written for an unverified or restricted member too: support
     * is how they get help with exactly that (SupportTicketPolicy); not for a closed account.
     */
    public function supportReply(User $recipient, SupportTicket $ticket): ?Notification
    {
        if ($recipient->isDeactivated() || $ticket->user_id !== $recipient->id) {
            return null;
        }

        return $this->grouped(
            NotificationType::SupportReply,
            $recipient,
            null,
            'support_reply:'.$ticket->id,
            null,
            fn (array $data): array => ['ticket_id' => $ticket->id, 'reference' => CreateSupportTicket::reference($ticket), 'replied_at' => now()->toIso8601String()],
            reaches: true,
        );
    }

    /**
     * M4.12 (ADM-53): staff approved or rejected $event. One row per submission (submitted_at), so a resubmitted event is told again;
     * details {event_id, outcome, reason} (the reason only on a rejection).
     */
    public function eventReviewed(User $organiser, Event $event, bool $approved, ?string $reason): ?Notification
    {
        $submitted = $event->getAttribute('submitted_at');

        return $this->grouped(NotificationType::EventReview, $organiser, null, 'event_review:'.$event->id.':'.($submitted instanceof CarbonImmutable ? $submitted->getTimestamp() : 0), null, fn (array $data): array => [
            'event_id' => $event->id,
            'outcome' => $approved ? 'approved' : 'rejected',
            'reason' => $approved || $reason === null ? null : mb_substr($reason, 0, 1000),
        ]);
    }

    /**
     * M4.12: a spot freed up and $member moved from the waitlist to "going". One row per event; a later promotion (after leaving and
     * joining the waitlist again) moves it up.
     */
    public function eventPromoted(User $member, Event $event): ?Notification
    {
        if ($this->blockedFromEvent($member, $event)) {
            return null;
        }

        return $this->grouped(NotificationType::EventPromoted, $member, null, 'event_promoted:'.$event->id, null, fn (array $data): array => [
            'event_id' => $event->id,
            'promoted_at' => now()->toIso8601String(),
        ]);
    }

    /**
     * M4.12 (09 §8.7): $event starts in 24 h or 2 h ($kind "24h" | "2h"). One row per event and kind: run again, it changes nothing. An
     * e-mail too when the member switched it on in SET-09 (`event_reminder.email`, off by default).
     */
    public function eventReminder(User $member, Event $event, string $kind): ?Notification
    {
        if ($this->blockedFromEvent($member, $event)) {
            return null;
        }

        // With the start in the key: a moved event reminds again.
        $key = 'event_reminder:'.$event->id.':'.$kind.':'.($event->starts_at?->getTimestamp() ?? 0);
        $existed = Notification::query()->where('notifiable_id', $member->id)->where('group_key', $key)->exists();
        $row = $this->grouped(NotificationType::EventReminder, $member, null, $key, null, fn (array $data): array => ['event_id' => $event->id, 'kind' => $kind]);

        if ($row !== null && ! $existed && (NotificationPrefs::for($member)['types']['event_reminder']['email'] ?? false)) {
            // From the scheduled command, not a request: sent at once, one by one.
            $this->mailer->send($member->email, app(NotificationTexts::class)->locale($member), new EventReminderMail($event->title, $kind, $event->slug, $event->starts_at));
        }

        return $row;
    }

    /**
     * M4.12 (EVT-06): the organiser posted $update to the attendees. One row per update; never the text.
     */
    public function eventUpdate(User $member, Event $event, EventUpdate $update): ?Notification
    {
        if ($this->blockedFromEvent($member, $event)) {
            return null;
        }

        return $this->grouped(NotificationType::EventUpdate, $member, null, 'event_update:'.$update->id, null, fn (array $data): array => [
            'event_id' => $event->id,
            'kind' => 'update',
            'update_id' => $update->id,
        ]);
    }

    /**
     * M4.12: the organiser changed the time or the place of $event ($token, the moment of the change). Security review SEC-412-02: one row
     * per event, updated in place (unread again) by every further change, and pushed at most once per group cooldown, so repeated
     * changes cannot flood attendees.
     */
    public function eventChanged(User $member, Event $event, string $token): ?Notification
    {
        if ($this->blockedFromEvent($member, $event)) {
            return null;
        }

        return $this->grouped(NotificationType::EventUpdate, $member, null, 'event_changed:'.$event->id, null, fn (array $data): array => [
            'event_id' => $event->id,
            'kind' => 'changed',
            'update_id' => null,
            'changed_at' => $token,
        ]);
    }

    /**
     * M4.12: $event was cancelled, by its organiser or ($byStaff) by staff. One row per event; the reason is read on EVT-02.
     */
    public function eventCancelled(User $member, Event $event, bool $byStaff = false): ?Notification
    {
        if (! $byStaff && $this->blockedFromEvent($member, $event)) {
            return null;
        }

        return $this->grouped(NotificationType::EventCancelled, $member, null, 'event_cancelled:'.$event->id, null, fn (array $data): array => [
            'event_id' => $event->id,
            'by_staff' => $byStaff,
        ]);
    }

    /**
     * M4.13 (09 §8.8): a maintenance reminder stage of $item ($stage: key, kind, due_on, due_km, lead_days). One row per stage, its group
     * key the stage's deterministic reminder key (also in the push data as `reminder_key`, so the app drops its local backup). An e-mail
     * too when the owner switched e-mails on for "Fälligkeiten" in SET-09 (`hu_au_reminder.email`, off by default).
     *
     * @param  array{key: string, kind: 'date'|'km', due_on: string|null, due_km: int|null, lead_days: int|null}  $stage
     */
    public function maintenanceDue(User $owner, Vehicle $vehicle, MaintenanceItem $item, array $stage): ?Notification
    {
        $key = $stage['key'];
        $existed = Notification::query()->where('notifiable_id', $owner->id)->where('group_key', $key)->exists();
        $row = $this->grouped(NotificationType::MaintenanceDue, $owner, null, $key, $vehicle, fn (array $data): array => [
            'item_id' => $item->id,
            'item_type' => $item->type->value,
            'title' => $item->title,
            'kind' => $stage['kind'],
            'due_on' => $stage['due_on'],
            'due_km' => $stage['due_km'],
            'lead_days' => $stage['lead_days'],
            'reminder_key' => $key,
        ]);

        if ($row !== null && ! $existed && (NotificationPrefs::for($owner)['types']['hu_au_reminder']['email'] ?? false)) {
            $locale = app(NotificationTexts::class)->locale($owner);
            $title = app(VehiclePresenter::class)->title($vehicle);
            // From the daily command, not a request: sent at once, one by one.
            $this->mailer->send($owner->email, $locale, new MaintenanceDueMail($title, app(MaintenanceTexts::class)->sentence($row->data ?? [], $title, $owner, $locale), (string) $vehicle->id));
        }

        return $row;
    }

    /**
     * Nothing about an event reaches a member who blocked its organiser or whom the organiser blocked (02 §3.5).
     */
    private function blockedFromEvent(User $member, Event $event): bool
    {
        $organiser = $event->organiser;

        return ! $organiser->is($member) && $member->hasBlockWith($organiser);
    }

    /**
     * Whether $actor may appear in $recipient's notifications at all.
     */
    public function mayShow(User $recipient, User $actor): bool
    {
        return ! $actor->is($recipient)
            && $actor->hasUsername()
            && $actor->isPubliclyVisible()
            && ! $recipient->hasBlockWith($actor);
    }

    /**
     * @param  Closure(array<string, mixed>): array<string, mixed>  $data
     */
    private function grouped(NotificationType $type, User $recipient, ?User $actor, string $groupKey, ?Vehicle $vehicle, Closure $data, ?int $count = null, bool $reaches = false): ?Notification
    {
        if (! ($reaches || $this->reaches($recipient)) || ($actor !== null && ! $this->mayShow($recipient, $actor))) {
            return null;
        }

        /** @var array{0: Notification, 1: bool} $result */
        $result = DB::transaction(function () use ($type, $recipient, $actor, $groupKey, $vehicle, $data, $count): array {
            $now = now();

            // Two writers of one group meet at the unique (notifiable_id, group_key): one inserts, both then update under the row lock.
            Notification::query()->insertOrIgnore([
                'id' => (new Notification)->newUniqueId(),
                'type' => $type->value,
                'notifiable_type' => 'user',
                'notifiable_id' => $recipient->id,
                'group_key' => $groupKey,
                'actor_count' => 0,
                'vehicle_id' => $vehicle?->id,
                'data' => null,
                'created_at' => $now,
                'updated_at' => $now,
            ]);

            $row = Notification::query()->where('notifiable_id', $recipient->id)->where('group_key', $groupKey)->lockForUpdate()->firstOrFail();
            $isNew = $row->data === null;
            $joined = $actor !== null && DB::table('notification_actors')->insertOrIgnore([
                'notification_id' => $row->id,
                'actor_id' => $actor->id,
                'created_at' => $now,
            ]) === 1;

            $before = $row->data ?? [];
            $after = $data($before);
            $actors = $count ?? $row->actor_count + ($joined ? 1 : 0);

            if (! $isNew && ! $joined && $this->same($after, $before) && $actors === $row->actor_count) {
                return [$row, false];
            }

            $row->forceFill([
                'actor_id' => $actor->id ?? $row->actor_id,
                'actor_count' => $actors,
                'vehicle_id' => $vehicle->id ?? $row->vehicle_id,
                'data' => $after,
                'read_at' => null,
                'created_at' => $now,
            ])->save();

            return [$row, true];
        }, 3);

        [$row, $changed] = $result;

        if ($changed) {
            $this->maybePush($row, $recipient);
        }

        return $row;
    }

    /**
     * Push after the row: the type's switch, quiet hours, one push per group within the cooldown, claimed atomically on pushed_at.
     */
    private function decisionRow(NotificationType $type, User $recipient, Decision $decision): ?Notification
    {
        if ($recipient->trashed() || $recipient->isDeactivated()) {
            return null;
        }

        $row = new Notification;
        $row->forceFill([
            'type' => $type,
            'notifiable_type' => 'user',
            'notifiable_id' => $recipient->id,
            'data' => $type === NotificationType::ReportDecided
                ? ['decision_id' => $decision->id, 'outcome' => $decision->outcome()->value]
                : ['decision_id' => $decision->id, 'action' => $decision->action->value],
            'created_at' => now(),
        ])->save();

        $this->maybePush($row, $recipient);

        return $row;
    }

    private function maybePush(Notification $row, User $recipient): void
    {
        $preference = $row->type->pushPreference();
        $wanted = $preference === null ? $row->type->alwaysPushes() : NotificationPrefs::wantsPush($recipient, $preference);

        if (! $wanted || ! $this->push->enabled()) {
            return;
        }

        if (! $row->type->isUrgent() && QuietHours::active($recipient)) {
            return;
        }

        // 09 §8.17: some types push at most once per period across all their rows (reactions: once an hour).
        $throttle = $row->type->pushThrottleMinutes();

        if ($throttle !== null && Notification::query()->where('notifiable_id', $recipient->id)->where('type', $row->type)
            ->where('pushed_at', '>', now()->subMinutes($throttle))->exists()) {
            return;
        }

        if (! PushToken::query()->where('user_id', $recipient->id)->exists()) {
            return;
        }

        $claimed = Notification::query()
            ->whereKey($row->id)
            ->where(fn ($query) => $query->whereNull('pushed_at')->orWhere('pushed_at', '<=', now()->subMinutes(config()->integer('speedclub.notifications.group_push_cooldown_minutes'))))
            ->toBase()
            ->update(['pushed_at' => now()]);

        if ($claimed !== 1) {
            return;
        }

        SendPushNotification::dispatch($row->id);
    }

    /**
     * A JSON column hands objects back in an order of its own (MySQL sorts keys by length), so compare without key order.
     *
     * @param  array<mixed>  $first
     * @param  array<mixed>  $second
     */
    private function same(array $first, array $second): bool
    {
        $sorted = function (mixed $value) use (&$sorted): mixed {
            if (! is_array($value)) {
                return $value;
            }

            if (! array_is_list($value)) {
                ksort($value);
            }

            return array_map($sorted, $value);
        };

        return $sorted($first) === $sorted($second);
    }

    private function reaches(User $recipient): bool
    {
        return ! $recipient->trashed() && $recipient->isActive() && $recipient->hasVerifiedEmail();
    }

    /**
     * Groups count days in Europe/Berlin, as members live them.
     */
    private function day(): string
    {
        return CarbonImmutable::now(config()->string('speedclub.notifications.timezone'))->toDateString();
    }

    /**
     * @return list<string> newest first, without repeats, at most MAX_IDS
     */
    private function ids(mixed $existing, ?string $add): array
    {
        $ids = is_array($existing) ? array_values(array_filter($existing, is_string(...))) : [];

        if ($add !== null) {
            $ids = [$add, ...array_values(array_diff($ids, [$add]))];
        }

        return array_slice($ids, 0, self::MAX_IDS);
    }
}
