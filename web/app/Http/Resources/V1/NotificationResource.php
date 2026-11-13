<?php

namespace App\Http\Resources\V1;

use App\Enums\NotificationType;
use App\Models\Event;
use App\Models\Notification;
use App\Models\User;
use App\Models\Vehicle;
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
             * By type, language-free. Named details, not data: Laravel (and the export) leave a single resource unwrapped when its
             * body already has a key "data". followed_published: {kind: "vehicle"|"update", update_id, vehicles, updates} (kind of the latest
             * event; how many builds were published and updates posted that day). build_saved: {count, week} ("2026-W45"). security:
             * {event: "new_device"|"password_changed"|"email_changed"|"two_factor_changed"|"deletion_requested"|"sessions_revoked"|"verification_failed"|"recovery_code_used", device_name, security_event_id (M4.7: the SET-21 row of a login alert, else null)}.
             * new_follower: {}. moderation_decision (a decision about the reader's content or account): {decision_id, action:
             * "remove_content"|"restrict"|"suspend"}. report_decided (the outcome of a case the reader reported): {decision_id, outcome:
             * "no_action"|"remove_content"|"measures"}, never the measure. SAFE-01 opens the decision.
             * qr_milestone [SIG]: {milestone: 10|50|100|500|1000}, total scans of the vehicle's stickers; QR-02 opens. hu_au_reminder [SIG]:
             * {due: "2027-03"}, the month the HU/AU is due; GAR-06 opens. catalog_request (M3.3): {outcome: "accepted"|"rejected", requested:
             * the make and model the member typed, reason: why it was declined (rejected only), else null}; the vehicle is the member's own.
             * support_reply (Phase 3): {ticket_id, reference: "SC-7H2KQXMB"}, the team answered that support request; SET-15b opens the
             * thread. Never the text of the answer. M4.11: reaction {target: "vehicle"|"build_update", update_id} (the owner's own item;
             * actors are who reacted, never how), mention {update_id, comment_id} (comment_id null for a mention in the update itself),
             * comment [build_comments] {update_id, comment_id (the newest), reply: a reply to the reader's comment}, vehicle_follower {}
             * (vehicle is the reader's build). update_id is null once the reader may no longer see the update; the row then opens the build.
             * M4.12 (the event is in `event`): event_review {outcome: "approved"|"rejected", reason (rejected only)}, event_promoted {} (the
             * reader moved from the waitlist to going), event_reminder {kind: "24h"|"2h"}, event_update {kind: "update"|"changed" (time or
             * place changed), update_id}, event_cancelled {by_staff}. Never the text of an update. M4.13 maintenance_due (vehicle: the
             * reader's own): {kind: "date"|"km", item_id, item_type, due_on (YYYY-MM-DD) or due_km, lead_days, reminder_key (the id of the
             * app's local backup notification, also in the push data)}; MNT-01 opens.
             *
             * @var array{kind?: 'vehicle'|'update'|'changed'|'24h'|'2h'|'date'|'km', update_id?: string|null, vehicles?: int, updates?: int, count?: int, week?: string|null, event?: string|null, device_name?: string|null, decision_id?: string|null, action?: string|null, outcome?: string|null, milestone?: int, due?: string|null, requested?: string|null, reason?: string|null, ticket_id?: string|null, reference?: string|null, target?: 'vehicle'|'build_update', comment_id?: string|null, reply?: bool, security_event_id?: string|null, by_staff?: bool, item_id?: string|null, item_type?: string|null, due_on?: string|null, due_km?: int|null, lead_days?: int|null, reminder_key?: string|null}
             */
            'details' => $this->data($row),
            /** @var string|null */
            'read_at' => $read instanceof CarbonInterface ? $read->toIso8601String() : null,
            /** The row's latest event, ISO 8601. */
            'created_at' => $created instanceof CarbonInterface ? $created->toIso8601String() : null,
        ];
    }

    /**
     * @return array{kind?: string, update_id?: string|null, vehicles?: int, updates?: int, count?: int, week?: string|null, event?: string|null, device_name?: string|null, decision_id?: string|null, action?: string|null, outcome?: string|null, milestone?: int, due?: string|null, requested?: string|null, reason?: string|null, ticket_id?: string|null, reference?: string|null, target?: string, comment_id?: string|null, reply?: bool, security_event_id?: string|null, by_staff?: bool, item_id?: string|null, item_type?: string|null, due_on?: string|null, due_km?: int|null, lead_days?: int|null, reminder_key?: string|null}
     */
    private function data(Notification $row): array
    {
        $data = $row->data ?? [];
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
            NotificationType::Mention => [
                'update_id' => in_array($string('update_id'), $row->visibleUpdateIds, true) ? $string('update_id') : null,
                'comment_id' => $string('comment_id'),
            ],
            NotificationType::Comment => [
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
