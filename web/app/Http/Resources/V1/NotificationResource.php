<?php

namespace App\Http\Resources\V1;

use App\Enums\NotificationType;
use App\Http\Resources\V1\Forum\ForumThreadRefResource;
use App\Models\Event;
use App\Models\ForumThread;
use App\Models\Notification;
use App\Models\User;
use App\Models\Vehicle;
use App\Services\Notifications\NotificationTexts;
use Carbon\CarbonInterface;
use Illuminate\Http\Request;
use Illuminate\Http\Resources\Json\JsonResource;
use Illuminate\Support\Collection;

/**
 * A row of HOME-02 (M2.2). The app writes the sentence from type, actors and actor_count in its own language ("lukas.sc und 3 weitere
 * folgen dir jetzt"); details holds what else the type needs, never text. Loaded through App\Services\Notifications\NotificationFeed.
 *
 * @property Notification $resource
 */
class NotificationResource extends JsonResource
{
    /**
     * @return array<string, mixed>
     */
    public function toArray(Request $request): array
    {
        $row = $this->resource;
        /** @var Collection<int, User> $actors */
        $actors = $row->relationLoaded('shownActors') ? $row->getRelation('shownActors') : collect();
        $vehicle = $row->relationLoaded('vehicle') ? $row->getRelation('vehicle') : null;
        $event = $row->relationLoaded('event') ? $row->getRelation('event') : null;
        $created = $row->getAttribute('created_at');
        $read = $row->getAttribute('read_at');

        return [
            'id' => $row->id,
            'type' => $row->type,
            /**
             * Rows of one group share it: "new_follower:2026-11-08". Null for rows that never group (security).
             */
            'group_key' => $row->group_key,
            /**
             * Newest first, at most three, only members the reader may see now.
             *
             * @var list<NotificationActorResource>
             */
            // Mapped one by one: MemberSummaryResource::collection() would make Scramble type every subclass's collection() (such as
            // ConnectionResource on PROF-04) as a page of MemberSummaryResource.
            // M4.8: with `main_vehicle_cover` for the car badge on the avatar.
            'actors' => $actors->values()->map(fn (User $actor): NotificationActorResource => new NotificationActorResource($actor))->all(),
            /**
             * new_follower, followed_published, reaction, mention, comment, vehicle_follower: how many members the row is about (the shown ones included), so "und 3 weitere" is
             * actor_count − 1. build_saved: how many members saved the build that week (never who). security: 0.
             */
            'actor_count' => $row->visibleActorCount,
            /**
             * The build the row is about, while the reader may see it; null otherwise and for new_follower and security.
             */
            'vehicle' => $vehicle instanceof Vehicle ? new VehicleRefResource($vehicle) : null,
            /**
             * M4.12: the event an event_* row is about, while the reader may see it; null otherwise and for every other type.
             */
            'event' => $event instanceof Event ? new EventRefResource($event) : null,
            /**
             * M5.8: the thread a forum_* row is about, while the reader may see it; null otherwise and for every other type.
             */
            'forum_thread' => ($thread = $row->relationLoaded('forumThread') ? $row->getRelation('forumThread') : null) instanceof ForumThread ? new ForumThreadRefResource($thread) : null,
            /**
             * By type, language-free. Named details, not data: Laravel (and the export) leave a single resource unwrapped when its
             * body already has a key "data". followed_published: {kind: "vehicle"|"update", update_id, vehicles, updates} (kind of the latest
             * event; how many builds were published and updates posted that day). build_saved: {count, week} ("2026-W45"). security:
             * {event: "new_device"|"password_changed"|"email_changed"|"two_factor_changed"|"deletion_requested"|"sessions_revoked"|"verification_failed"|"recovery_code_used", device_name, security_event_id (M4.7: the SET-21 row of a login alert, else null)}.
             * new_follower: {}. moderation_decision (a decision about the reader's content or account): {decision_id, action:
             * "remove_content"|"restrict"|"suspend"}. report_decided (the outcome of a case the reader reported): {decision_id, outcome:
             * "no_action"|"remove_content"|"measures"}, never the measure. SAFE-01 opens the decision.
             * qr_milestone [SIG]: {milestone: 10|50|100|500|1000}, total scans of the vehicle's stickers; STK-02 opens. hu_au_reminder [SIG]:
             * {due: "2027-03"}, the month the HU/AU is due; GAR-06 opens. catalog_request (M3.3): {outcome: "accepted"|"rejected", requested:
             * the make and model the member typed, reason: why it was declined (rejected only), else null}; the vehicle is the member's own.
             * support_reply (Phase 3): {ticket_id, reference: "SC-7H2KQXMB"}, the team answered that support request; SET-15b opens the
             * thread. Never the text of the answer. M4.11: reaction {target: "vehicle"|"build_update", update_id} (the owner's own item;
             * actors are who reacted, never how), mention {target, update_id, comment_id} (comment_id null for a mention in the update itself),
             * comment [build_comments] {target, update_id, comment_id (the newest), reply: a reply to the reader's comment}, where R5-5's
             * target is "vehicle" for the car's own comment thread (update_id null; VEH-01 opens with its comments) and "build_update"
             * otherwise, vehicle_follower {}
             * (vehicle is the reader's build). update_id is null once the reader may no longer see the update; the row then opens the build.
             * M4.12 (the event is in `event`): event_review {outcome: "approved"|"rejected", reason (rejected only)}, event_promoted {} (the
             * reader moved from the waitlist to going), event_reminder {kind: "24h"|"2h"}, event_update {kind: "update"|"changed" (time or
             * place changed), update_id}, event_cancelled {by_staff}. Never the text of an update. M4.13 maintenance_due (vehicle: the
             * reader's own): {kind: "date"|"km", item_id, item_type, due_on (YYYY-MM-DD) or due_km, lead_days, reminder_key (the id of the
             * app's local backup notification, also in the push data)}; MNT-01 opens. M4.14 (in-app only): business_review {outcome:
             * "verified"|"rejected"|"suspended"|"reinstated"|"reopened" (SEC-414-03: a verified business went back to review), business_id, reason (rejected and suspended only)}, BIZ-03 opens; business_tag
             * {state: "requested"|"accepted"|"declined", side: "business" (the business must act or hears back; BIZ-04 opens) | "member" (the
             * build's owner; VEH-02 opens), tag_id, business_id, mod_id} (vehicle: the build of the mod). SEC-414-01 business_invite
             * {state: "invited"|"removed" (side "member": a business invited the reader to its team, open it with GET me/business-invites;
             * or removed them) | "accepted"|"declined"|"left" (side "business": the member answered or left; BIZ-03 opens), business_id,
             * invite_id (invited only; the id for POST me/business-invites/{invite}/accept), username (the other side)}. M5.9b spot_alert (vehicle: the
             * reader's own car; DEX-06 opens): {day: "YYYY-MM-DD" (Europe/Berlin), count (counted spots that day), cities_count (cities of the
             * day's day spots; 0 for night-only days and while the car hides its cities), city (the name when cities_count is 1, else null)};
             * "Dein EK9 wurde heute 4-mal in Düsseldorf gespottet." Never who spotted it. M5.8 (the thread is in `forum_thread`): forum_reply
             * {thread_id, post_id (the newest reply), reply_to: "thread" (in the reader's thread or subscription) | "post" (to the reader's
             * post)}, forum_mention {thread_id, post_id}, forum_solved {thread_id, post_id (the reader's reply marked as the solution)}.
             * M5.6 (the event is in `event`): event_gallery_pending {count (attendee photos waiting for the reader's approval today)};
             * event_photo_decided {outcome: "approved"|"rejected", photo_id} (in-app only; the reason is on EVT-02); event_nearby {count, week
             * ("2026-W47"), event_ids (soonest first; `event` is the first)}, "Neue Treffen in deiner Nähe"; EVT-01 opens.
             * M5.7 plan_due {modification_id, target_month: "2026-11"} (vehicle: the reader's own; VEH-01 Pläne opens), "Ist das KW V3 schon
             * verbaut?"; weekly_recap {week: "2026-11-16" (Monday), views, sticker_scans, new_followers, spots, events_nearby,
             * maintenance_due}, counts only; INS-01 opens. R4-2.3 crew (in-app only): {state: "request_received" (to founder/admins; the
             * crew's requests open) | "request_approved" (CREW-01 opens) | "invited" (GET me/crew-invites; invite_id for POST
             * me/crew-invites/{invite}/accept), crew_id, crew_slug, crew_name, username (requester or inviter; null for request_approved),
             * invite_id, request_id}.
             *
             * @var array{kind?: 'vehicle'|'update'|'changed'|'24h'|'2h'|'date'|'km', update_id?: string|null, vehicles?: int, updates?: int, count?: int, week?: string|null, event?: string|null, device_name?: string|null, decision_id?: string|null, action?: string|null, outcome?: string|null, milestone?: int, due?: string|null, requested?: string|null, reason?: string|null, ticket_id?: string|null, reference?: string|null, target?: 'vehicle'|'build_update', comment_id?: string|null, reply?: bool, security_event_id?: string|null, by_staff?: bool, item_id?: string|null, item_type?: string|null, due_on?: string|null, due_km?: int|null, lead_days?: int|null, reminder_key?: string|null, business_id?: string|null, state?: string|null, side?: string|null, tag_id?: string|null, mod_id?: string|null, invite_id?: string|null, username?: string|null, day?: string|null, cities_count?: int, city?: string|null, badge_key?: string|null, tier?: string|null, code?: string|null, thread_id?: string|null, post_id?: string|null, reply_to?: string|null, photo_id?: string|null, event_ids?: list<string>, modification_id?: string|null, target_month?: string|null, views?: int, sticker_scans?: int, new_followers?: int, spots?: int, events_nearby?: int, maintenance_due?: int, crew_id?: string|null, crew_slug?: string|null, crew_name?: string|null, request_id?: string|null}
             */
            'details' => $this->data($row),
            /** @var string|null */
            'read_at' => $read instanceof CarbonInterface ? $read->toIso8601String() : null,
            /** The row's latest event, ISO 8601. */
            'created_at' => $created instanceof CarbonInterface ? $created->toIso8601String() : null,
        ];
    }

    /**
     * @return array{kind?: string, update_id?: string|null, vehicles?: int, updates?: int, count?: int, week?: string|null, event?: string|null, device_name?: string|null, decision_id?: string|null, action?: string|null, outcome?: string|null, milestone?: int, due?: string|null, requested?: string|null, reason?: string|null, ticket_id?: string|null, reference?: string|null, target?: string, comment_id?: string|null, reply?: bool, security_event_id?: string|null, by_staff?: bool, item_id?: string|null, item_type?: string|null, due_on?: string|null, due_km?: int|null, lead_days?: int|null, reminder_key?: string|null, business_id?: string|null, state?: string|null, side?: string|null, tag_id?: string|null, mod_id?: string|null, invite_id?: string|null, username?: string|null, day?: string|null, cities_count?: int, city?: string|null, badge_key?: string|null, tier?: string|null, code?: string|null, thread_id?: string|null, post_id?: string|null, reply_to?: string|null, photo_id?: string|null, event_ids?: list<string>, modification_id?: string|null, target_month?: string|null, views?: int, sticker_scans?: int, new_followers?: int, spots?: int, events_nearby?: int, maintenance_due?: int, crew_id?: string|null, crew_slug?: string|null, crew_name?: string|null, request_id?: string|null}
     */
    private function data(Notification $row): array
    {
        $data = $row->data ?? [];
        $vehicle = $row->relationLoaded('vehicle') ? $row->getRelation('vehicle') : null;
        $count = fn (string $key): int => is_array($data[$key] ?? null) ? count($data[$key]) : 0;
        $string = fn (string $key): ?string => is_string($data[$key] ?? null) ? $data[$key] : null;

        return match ($row->type) {
            NotificationType::FollowedPublished => [
                'kind' => $string('kind') ?? 'update',
                // A build update the owner hid since is not named or counted (M2.2 review #11).
                'update_id' => in_array($string('update_id'), $row->visibleUpdateIds, true) ? $string('update_id') : null,
                'vehicles' => $count('published_ids'),
                'updates' => count($row->visibleUpdateIds),
            ],
            NotificationType::BuildSaved => ['count' => (int) ($data['count'] ?? $row->actor_count), 'week' => $string('week')],
            // M4.7: a login alert names its SET-21 row, which the app opens.
            NotificationType::Security => ['event' => $string('event'), 'device_name' => $string('device_name'), 'security_event_id' => $string('security_event_id')],
            NotificationType::NewFollower => [],
            NotificationType::ModerationDecision => ['decision_id' => $string('decision_id'), 'action' => $string('action')],
            NotificationType::ReportDecided => ['decision_id' => $string('decision_id'), 'outcome' => $string('outcome')],
            NotificationType::QrMilestone => ['milestone' => (int) ($data['milestone'] ?? 0)],
            NotificationType::HuAuReminder => ['due' => $string('due')],
            NotificationType::CatalogRequest => ['outcome' => $string('outcome'), 'requested' => $string('requested'), 'reason' => $string('reason')],
            NotificationType::SupportReply => ['ticket_id' => $string('ticket_id'), 'reference' => $string('reference')],
            // M4.11: the update while the reader may still see it (else null and the row opens the build); never a reaction type or text.
            NotificationType::Reaction => [
                'target' => $string('target') ?? 'build_update',
                'update_id' => in_array($string('update_id'), $row->visibleUpdateIds, true) ? $string('update_id') : null,
            ],
            // R5-5: target "vehicle" for the car's own comment thread (VEH-01 opens with its comments), "build_update" otherwise.
            NotificationType::Mention => [
                'target' => $string('target') ?? 'build_update',
                'update_id' => in_array($string('update_id'), $row->visibleUpdateIds, true) ? $string('update_id') : null,
                'comment_id' => $string('comment_id'),
            ],
            NotificationType::Comment => [
                'target' => $string('target') ?? 'build_update',
                'update_id' => in_array($string('update_id'), $row->visibleUpdateIds, true) ? $string('update_id') : null,
                'comment_id' => $string('comment_id'),
                'reply' => ($data['reply'] ?? false) === true,
            ],
            NotificationType::VehicleFollower => [],
            NotificationType::EventReview => ['outcome' => $string('outcome'), 'reason' => $string('reason')],
            NotificationType::EventPromoted => [],
            NotificationType::EventReminder => ['kind' => $string('kind') ?? '24h'],
            NotificationType::EventUpdate => ['kind' => $string('kind') ?? 'update', 'update_id' => $string('update_id')],
            NotificationType::EventCancelled => ['by_staff' => ($data['by_staff'] ?? false) === true],
            // M5.6: photos waiting today; the decision on the reader's photo; the week's new meets nearby (the first is in `event`).
            NotificationType::EventGalleryPending => ['count' => (int) ($data['count'] ?? 0)],
            NotificationType::EventPhotoDecided => ['outcome' => $string('outcome'), 'photo_id' => $string('photo_id')],
            NotificationType::EventNearby => ['count' => (int) ($data['count'] ?? 0), 'week' => $string('week'), 'event_ids' => array_values(array_filter((array) ($data['event_ids'] ?? []), is_string(...)))],
            NotificationType::BusinessReview => ['outcome' => $string('outcome'), 'business_id' => $string('business_id'), 'reason' => $string('reason')],
            NotificationType::BusinessTag => ['state' => $string('state'), 'side' => $string('side'), 'tag_id' => $string('tag_id'), 'business_id' => $string('business_id'), 'mod_id' => $string('mod_id')],
            NotificationType::BusinessInvite => ['state' => $string('state'), 'side' => $string('side'), 'business_id' => $string('business_id'), 'invite_id' => $string('invite_id'), 'username' => $string('username')],
            // R4-2.3 (in-app only).
            NotificationType::Crew => ['state' => $string('state'), 'crew_id' => $string('crew_id'), 'crew_slug' => $string('crew_slug'), 'crew_name' => $string('crew_name'), 'username' => $string('username'), 'invite_id' => $string('invite_id'), 'request_id' => $string('request_id')],
            NotificationType::SpotAlert => (function () use ($row, $vehicle, $data): array {
                $cities = NotificationTexts::spotAlertCities($row, $vehicle instanceof Vehicle ? $vehicle : null);

                return [
                    'day' => is_string($data['day'] ?? null) ? $data['day'] : null,
                    'count' => (int) ($data['count'] ?? 0),
                    'cities_count' => count($cities),
                    'city' => count($cities) === 1 ? $cities[0] : null,
                ];
            })(),
            // M5.9d: the badge (the app reads its name from GET me/badges), the day of the pick, the redeemed code.
            NotificationType::BadgeUnlocked => ['badge_key' => $string('badge_key'), 'tier' => $string('tier')],
            NotificationType::CarOfTheDay, NotificationType::CarOfTheDayOwner => ['day' => $string('day')],
            NotificationType::InviteAccepted => ['code' => $string('code')],
            // M5.8: the thread is in `forum_thread`; post_id opens FOR-03 at the post.
            NotificationType::ForumReply => ['thread_id' => $string('thread_id'), 'post_id' => $string('post_id'), 'reply_to' => $string('reply_to') ?? 'thread'],
            NotificationType::ForumMention, NotificationType::ForumSolved => ['thread_id' => $string('thread_id'), 'post_id' => $string('post_id')],
            // M5.7: the plan asked about (the vehicle is the reader's own); the week's numbers, counts only.
            NotificationType::PlanDue => ['modification_id' => $string('modification_id'), 'target_month' => $string('target_month')],
            NotificationType::WeeklyRecap => [
                'week' => $string('week'),
                'views' => (int) ($data['views'] ?? 0),
                'sticker_scans' => (int) ($data['sticker_scans'] ?? 0),
                'new_followers' => (int) ($data['new_followers'] ?? 0),
                'spots' => (int) ($data['spots'] ?? 0),
                'events_nearby' => (int) ($data['events_nearby'] ?? 0),
                'maintenance_due' => (int) ($data['maintenance_due'] ?? 0),
            ],
            NotificationType::MaintenanceDue => [
                'kind' => $string('kind') ?? 'date',
                'item_id' => $string('item_id'),
                'item_type' => $string('item_type'),
                'due_on' => $string('due_on'),
                'due_km' => is_int($data['due_km'] ?? null) ? $data['due_km'] : null,
                'lead_days' => is_int($data['lead_days'] ?? null) ? $data['lead_days'] : null,
                'reminder_key' => $string('reminder_key'),
            ],
        };
    }
}
