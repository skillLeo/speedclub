<?php

namespace App\Http\Resources\V1;

use App\Enums\NotificationType;
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
             * @var list<MemberSummaryResource>
             */
            // Mapped one by one: MemberSummaryResource::collection() would make Scramble type every subclass's collection() (such as
            // ConnectionResource on PROF-04) as a page of MemberSummaryResource.
            'actors' => $actors->values()->map(fn (User $actor): MemberSummaryResource => new MemberSummaryResource($actor))->all(),
            /**
             * new_follower, followed_published: how many members the row is about (the shown ones included), so "und 3 weitere" is
             * actor_count − 1. build_saved: how many members saved the build that week (never who). security: 0.
             */
            'actor_count' => $row->visibleActorCount,
            /**
             * The build the row is about, while the reader may see it; null otherwise and for new_follower and security.
             */
            'vehicle' => $vehicle instanceof Vehicle ? new VehicleRefResource($vehicle) : null,
            /**
             * By type, language-free. Named details, not data: Laravel (and the export) leave a single resource unwrapped when its
             * body already has a key "data". followed_published: {kind: "vehicle"|"update", update_id, vehicles, updates} (kind of the latest
             * event; how many builds were published and updates posted that day). build_saved: {count, week} ("2026-W45"). security:
             * {event: "new_device"|"password_changed"|"email_changed"|"two_factor_changed"|"deletion_requested"|"sessions_revoked"|"verification_failed"|"recovery_code_used", device_name}.
             * new_follower: {}. moderation_decision (a decision about the reader's content or account): {decision_id, action:
             * "remove_content"|"restrict"|"suspend"}. report_decided (the outcome of a case the reader reported): {decision_id, outcome:
             * "no_action"|"remove_content"|"measures"}, never the measure. SAFE-01 opens the decision.
             * qr_milestone [SIG]: {milestone: 10|50|100|500|1000}, total scans of the vehicle's stickers; QR-02 opens. hu_au_reminder [SIG]:
             * {due: "2027-03"}, the month the HU/AU is due; GAR-06 opens. catalog_request (M3.3): {outcome: "accepted"|"rejected", requested:
             * the make and model the member typed, reason: why it was declined (rejected only), else null}; the vehicle is the member's own.
             * support_reply (Phase 3): {ticket_id, reference: "SC-7H2KQXMB"}, the team answered that support request; SET-15b opens the
             * thread. Never the text of the answer.
             *
             * @var array{kind?: 'vehicle'|'update', update_id?: string|null, vehicles?: int, updates?: int, count?: int, week?: string|null, event?: string|null, device_name?: string|null, decision_id?: string|null, action?: string|null, outcome?: string|null, milestone?: int, due?: string|null, requested?: string|null, reason?: string|null, ticket_id?: string|null, reference?: string|null}
             */
            'details' => $this->data($row),
            /** @var string|null */
            'read_at' => $read instanceof CarbonInterface ? $read->toIso8601String() : null,
            /** The row's latest event, ISO 8601. */
            'created_at' => $created instanceof CarbonInterface ? $created->toIso8601String() : null,
        ];
    }

    /**
     * @return array{kind?: string, update_id?: string|null, vehicles?: int, updates?: int, count?: int, week?: string|null, event?: string|null, device_name?: string|null, decision_id?: string|null, action?: string|null, outcome?: string|null, milestone?: int, due?: string|null, requested?: string|null, reason?: string|null, ticket_id?: string|null, reference?: string|null}
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
            NotificationType::Security => ['event' => $string('event'), 'device_name' => $string('device_name')],
            NotificationType::NewFollower => [],
            NotificationType::ModerationDecision => ['decision_id' => $string('decision_id'), 'action' => $string('action')],
            NotificationType::ReportDecided => ['decision_id' => $string('decision_id'), 'outcome' => $string('outcome')],
            NotificationType::QrMilestone => ['milestone' => (int) ($data['milestone'] ?? 0)],
            NotificationType::HuAuReminder => ['due' => $string('due')],
            NotificationType::CatalogRequest => ['outcome' => $string('outcome'), 'requested' => $string('requested'), 'reason' => $string('reason')],
            NotificationType::SupportReply => ['ticket_id' => $string('ticket_id'), 'reference' => $string('reference')],
        };
    }
}
