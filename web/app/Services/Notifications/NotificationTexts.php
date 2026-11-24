<?php

namespace App\Services\Notifications;

use App\Enums\ModStatus;
use App\Enums\NotificationType;
use App\Enums\SecurityNotice;
use App\Models\Badge;
use App\Models\Business;
use App\Models\Event;
use App\Models\ForumThread;
use App\Models\Modification;
use App\Models\Notification;
use App\Models\User;
use App\Models\Vehicle;
use App\Services\Content\MessageTemplates;
use App\Services\Engagement\RecapTexts;
use App\Services\Garage\VehiclePresenter;
use App\Services\Maintenance\MaintenanceTexts;
use App\Services\Privacy\OrgIdentity;
use App\Support\Units;
use Carbon\CarbonImmutable;
use Illuminate\Support\Facades\DB;

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
                // R5-5: a comment on the car itself.
                : trans_choice('notifications.comment.'.(($row->data['target'] ?? null) === 'vehicle' ? 'vehicle' : 'update'), max(1, $count), ['name' => $actor->username, 'count' => max(0, $count - 1), 'vehicle' => $this->presenter->title($vehicle)], $locale)),
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
            // M5.6: how many photos wait, never who sent them; the decision on a photo is in-app only; the nearby meets name the first.
            NotificationType::EventGalleryPending => $event === null ? null : trans_choice('notifications.event_gallery_pending', max(1, (int) ($row->data['count'] ?? 1)), [
                'count' => max(1, (int) ($row->data['count'] ?? 1)),
                'title' => $event->title,
            ], $locale),
            NotificationType::EventPhotoDecided => null,
            NotificationType::EventNearby => $event === null ? null : trans_choice('notifications.event_nearby.body', max(1, (int) ($row->data['count'] ?? 1)), [
                'title' => $event->title,
                'count' => max(0, (int) ($row->data['count'] ?? 1) - 1),
            ], $locale),
            // M4.13: the owner's own vehicle and item (MaintenanceTexts), in their distance unit.
            NotificationType::MaintenanceDue => $vehicle === null ? null : app(MaintenanceTexts::class)->sentence($row->data ?? [], $this->presenter->title($vehicle), $recipient, $locale),
            // M4.14: in-app only (no push switch); the business's own name, never a reason in the text.
            NotificationType::BusinessReview => ($business = $this->business($row)) === null ? null : (string) __('notifications.business_review.'.self::oneOf($row->data['outcome'] ?? null, ['verified', 'rejected', 'suspended', 'reinstated', 'reopened'], 'rejected'), ['name' => $business->name], $locale),
            NotificationType::BusinessTag => ($business = $this->business($row)) === null || $vehicle === null ? null : (string) __('notifications.business_tag.'.(($row->data['side'] ?? null) === 'business' ? 'business' : 'member').'.'.self::oneOf($row->data['state'] ?? null, ['requested', 'accepted', 'declined'], 'requested'), [
                'name' => $business->name,
                'vehicle' => $this->presenter->title($vehicle),
            ], $locale),
            // SEC-414-01: in-app only; the business's name and the member's username, nothing else.
            NotificationType::BusinessInvite => ($business = $this->business($row)) === null ? null : (string) __('notifications.business_invite.'.self::oneOf($row->data['state'] ?? null, ['invited', 'removed', 'accepted', 'declined', 'left'], 'invited'), [
                'name' => $business->name,
                'username' => is_string($row->data['username'] ?? null) ? $row->data['username'] : '',
            ], $locale),
            // R4-2.3: in-app only; the crew's name and the other side's username, nothing else.
            NotificationType::Crew => ! is_string($row->data['crew_name'] ?? null) ? null : (string) __('notifications.crew.'.self::oneOf($row->data['state'] ?? null, ['request_received', 'request_approved', 'invited'], 'invited'), [
                'name' => $row->data['crew_name'],
                'username' => is_string($row->data['username'] ?? null) ? $row->data['username'] : '',
            ], $locale),
            // M5.9b: the owner's own car, the day's count and, where allowed, its city or number of cities; never who spotted it.
            NotificationType::SpotAlert => $vehicle === null ? null : $this->spotAlert($row, $vehicle, $locale),
            // M5.9d: the badge's name in the recipient's language; the owner's own car; the pick of the day with its owner's username;
            // an invite code of the recipient (never who redeemed it).
            NotificationType::BadgeUnlocked => ($badge = Badge::query()->find(is_string($row->data['badge_key'] ?? null) ? $row->data['badge_key'] : '')) === null
                ? null
                : (string) __('notifications.badge_unlocked', ['name' => $badge->name($locale)], $locale),
            NotificationType::CarOfTheDayOwner => $vehicle === null ? null : (string) __('notifications.car_of_the_day_owner', ['vehicle' => $this->presenter->title($vehicle)], $locale),
            NotificationType::CarOfTheDay => $vehicle === null || ($owner = User::query()->find($vehicle->owner_id)) === null || $owner->username === null
                ? null
                : (string) __('notifications.car_of_the_day', ['vehicle' => $this->presenter->title($vehicle), 'name' => $owner->username], $locale),
            NotificationType::InviteAccepted => (string) __('notifications.invite_accepted', ['code' => is_string($row->data['code'] ?? null) ? $row->data['code'] : ''], $locale),
            // M5.8: the thread's public title, never a post's text; no push once the reader may no longer see the thread or the actor.
            NotificationType::ForumReply => ($thread = $this->forumThread($row)) === null || $actor === null ? null : (($row->data['reply_to'] ?? null) === 'post'
                ? (string) __('notifications.forum_reply.post', ['name' => $actor->username, 'title' => $thread->title], $locale)
                : trans_choice('notifications.forum_reply.thread', max(1, $count), ['name' => $actor->username, 'count' => max(0, $count - 1), 'title' => $thread->title], $locale)),
            NotificationType::ForumMention => ($thread = $this->forumThread($row)) === null || $actor === null ? null : (string) __('notifications.forum_mention', ['name' => $actor->username, 'title' => $thread->title], $locale),
            NotificationType::ForumSolved => ($thread = $this->forumThread($row)) === null ? null : (string) __('notifications.forum_solved', ['title' => $thread->title], $locale),
            // M5.7: the owner's own plan while it is still planned ("Ist das KW V3 schon verbaut?"); the week's non-zero numbers, never who.
            NotificationType::PlanDue => ($mod = $this->plannedMod($row)) === null ? null : (string) __('notifications.plan_due', ['mod' => trim((string) $mod->getAttribute('title'))], $locale),
            NotificationType::WeeklyRecap => RecapTexts::pushBody($row->data ?? [], $locale),
        };

        $title = match ($row->type) {
            NotificationType::EventNearby => 'notifications.event_nearby.title',
            NotificationType::WeeklyRecap => 'notifications.weekly_recap.title',
            default => 'notifications.title',
        };

        return $body === null ? null : ['title' => (string) __($title, [], $locale), 'body' => $body];
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
            // M5.4 (contract §10): the car's sticker detail STK-02.
            NotificationType::QrMilestone => $vehicle !== null ? '/stickers/'.$vehicle->id : '/notifications',
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
            // M4.14: BIZ-03 for the business owner, BIZ-04 for a tag waiting for the business, else the build.
            NotificationType::BusinessReview => '/business',
            // M5.9b: DEX-06, the owner's spots of the car.
            NotificationType::SpotAlert => $vehicle !== null ? '/vehicles/'.$vehicle->id.'/spots' : '/notifications',
            // M5.9d: the badge list, Start (the owner edits the story line there), the build, the invites screen.
            NotificationType::BadgeUnlocked => '/profile/badges',
            NotificationType::CarOfTheDayOwner => '/',
            NotificationType::CarOfTheDay => $vehicle !== null ? '/v/'.$vehicle->slug : '/',
            NotificationType::InviteAccepted => '/settings/invites',
            // M5.8: FOR-03 at the post while the reader may see the thread.
            NotificationType::ForumReply, NotificationType::ForumMention, NotificationType::ForumSolved => ($thread = $this->forumThread($row)) !== null
                ? $thread->path().(is_string($row->data['post_id'] ?? null) ? '?post='.$row->data['post_id'] : '')
                : '/notifications',
            // R4-2.3: CREW-01's requests for the admins, CREW-01 for an approved member, the member's open invitations.
            NotificationType::Crew => match (true) {
                ! is_string($row->data['crew_slug'] ?? null) => '/notifications',
                ($row->data['state'] ?? null) === 'request_received' => '/crews/'.$row->data['crew_slug'].'/requests',
                ($row->data['state'] ?? null) === 'invited' => '/crews/invites',
                default => '/crews/'.$row->data['crew_slug'],
            },
            // SEC-414-01: the member's open invitations, or BIZ-03 for the owner.
            NotificationType::BusinessInvite => ($row->data['state'] ?? null) === 'invited' ? '/business/invites' : (($row->data['side'] ?? null) === 'business' ? '/business' : '/notifications'),
            NotificationType::BusinessTag => ($row->data['side'] ?? null) === 'business'
                ? '/business/requests'
                : ($vehicle !== null ? '/v/'.$vehicle->slug.(is_string($row->data['mod_id'] ?? null) ? '?mod='.$row->data['mod_id'] : '') : '/notifications'),
            // M5.6: the organiser's photo queue on EVT-06, the uploader's photo on EVT-02, the week list EVT-01.
            NotificationType::EventGalleryPending => ($event = $this->event($row)) !== null ? '/events/'.$event->slug.'/manage#gallery' : '/notifications',
            NotificationType::EventNearby => '/events',
            // M5.7: the Pläne section of the owner's VEH-01, and INS-01.
            NotificationType::PlanDue => $vehicle !== null ? '/v/'.$vehicle->slug.'?section=plans' : '/notifications',
            NotificationType::WeeklyRecap => '/insights',
            NotificationType::EventReview, NotificationType::EventPromoted, NotificationType::EventReminder, NotificationType::EventUpdate, NotificationType::EventCancelled, NotificationType::EventPhotoDecided => ($event = $this->event($row)) !== null
                ? '/events/'.$event->slug
                : ($row->type === NotificationType::EventReview ? '/events/mine?tab=organised' : '/notifications'),
        };
    }

    /**
     * "Dein Skyline R34 wurde heute 4-mal in Düsseldorf gespottet." / "… in 3 Städten …" / without a city when the day had only night spots
     * or the owner hides the car's cities (now, not only when the row was written).
     */
    private function spotAlert(Notification $row, Vehicle $vehicle, string $locale): string
    {
        $count = max(1, (int) ($row->data['count'] ?? 1));
        $cities = self::spotAlertCities($row, $vehicle);
        $name = $this->presenter->shortTitle($vehicle) ?? $this->presenter->title($vehicle);
        $values = ['vehicle' => $name, 'count' => Units::formatNumber($count, $locale, 0)];

        return match (true) {
            count($cities) === 1 => trans_choice('notifications.spot_alert.city', $count, [...$values, 'city' => $cities[0]], $locale),
            count($cities) > 1 => trans_choice('notifications.spot_alert.cities', $count, [...$values, 'cities' => count($cities)], $locale),
            default => trans_choice('notifications.spot_alert.plain', $count, $values, $locale),
        };
    }

    /**
     * The names of a spot_alert row's cities as the owner may read them now: none while the car hides its cities.
     *
     * @return list<string>
     */
    public static function spotAlertCities(Notification $row, ?Vehicle $vehicle): array
    {
        $ids = array_values(array_filter((array) ($row->data['city_ids'] ?? []), is_int(...)));

        if ($ids === [] || $vehicle === null || $vehicle->hide_spot_cities) {
            return [];
        }

        return array_values(array_map(strval(...), DB::table('de_cities')->whereIn('id', $ids)->orderBy('name')->pluck('name')->all()));
    }

    private function business(Notification $row): ?Business
    {
        $id = $row->data['business_id'] ?? null;

        return is_string($id) ? Business::query()->find($id) : null;
    }

    /**
     * @param  list<string>  $allowed
     */
    private static function oneOf(mixed $value, array $allowed, string $default): string
    {
        return is_string($value) && in_array($value, $allowed, true) ? $value : $default;
    }

    private function updatePath(Notification $row, ?Vehicle $vehicle): string
    {
        $update = $row->data['update_id'] ?? null;

        // R5-5: a comment (or a mention in one) on the car itself opens VEH-01 with its comments.
        if ($vehicle !== null && ($row->data['target'] ?? null) === 'vehicle' && is_string($row->data['comment_id'] ?? null)) {
            return '/v/'.$vehicle->slug.'?comments=1';
        }

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

    private function forumThread(Notification $row): ?ForumThread
    {
        $thread = $row->relationLoaded('forumThread') ? $row->getRelation('forumThread') : null;

        return $thread instanceof ForumThread ? $thread : null;
    }

    /**
     * The row's mod while it is still planned (not deleted, not installed in the meantime).
     */
    private function plannedMod(Notification $row): ?Modification
    {
        $id = $row->data['modification_id'] ?? null;
        $mod = is_string($id) ? Modification::query()->find($id) : null;

        return $mod instanceof Modification && ModStatus::tryFrom((string) $mod->getRawOriginal('status')) === ModStatus::Planned ? $mod : null;
    }

    private function vehicle(Notification $row): ?Vehicle
    {
        $vehicle = $row->relationLoaded('vehicle') ? $row->getRelation('vehicle') : null;

        return $vehicle instanceof Vehicle ? $vehicle : null;
    }
}
