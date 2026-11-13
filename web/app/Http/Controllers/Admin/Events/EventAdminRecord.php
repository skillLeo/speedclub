<?php

namespace App\Http\Controllers\Admin\Events;

use App\Actions\Admin\Events\ReviewEvent;
use App\Enums\CaseStatus;
use App\Enums\EventAuditEvent;
use App\Enums\EventLocationVisibility;
use App\Enums\EventStatus;
use App\Enums\ReportTargetType;
use App\Http\Controllers\Admin\Support\MediaUrls;
use App\Models\AuditEvent;
use App\Models\Event;
use App\Models\EventUpdate;
use App\Models\ModerationCase;
use App\Models\Staff;
use App\Services\Audit\Audit;
use App\Services\Events\Rsvps;
use Carbon\CarbonImmutable;
use Illuminate\Support\Facades\Cache;

/**
 * The props of ADM-53 rows and the ADM-54 record (09 §10.2): staff see the exact place (they review it), the organiser with their
 * history, answers, updates, open reports and the event's audit trail. Never a member's e-mail here (members.view_pii is ADM-10's).
 */
final class EventAdminRecord
{
    /**
     * @param  list<Event>  $events
     * @return list<array<string, mixed>>
     */
    public static function rows(array $events): array
    {
        $ids = array_map(fn (Event $event): string => $event->id, $events);
        $counts = app(Rsvps::class)->counts($ids);
        $reports = self::openReports($ids);
        $approved = self::approvedCounts(array_values(array_unique(array_map(fn (Event $event): string => $event->organiser_id, $events))));

        return array_map(fn (Event $event): array => [
            'id' => $event->id,
            'slug' => $event->slug,
            'title' => $event->title,
            'type' => $event->type->value,
            'status' => $event->status->value,
            'visibility' => $event->visibility->value,
            'location_visibility' => $event->location_visibility->value,
            'starts_at' => $event->starts_at?->toIso8601String(),
            'ends_at' => $event->ends_at?->toIso8601String(),
            'city' => $event->city,
            'submitted_at' => $event->getAttribute('submitted_at')?->toIso8601String(),
            // Security review SEC-412-01: sent back with an approval; a changed event is not approved.
            'version' => ReviewEvent::version($event),
            // Fields the organiser changed since the last approval ("geändert seit der Freigabe"), else an empty list.
            'changed_since_review' => array_values(array_filter((array) ($event->getAttribute('review_changes') ?? []), is_string(...))),
            // SLA timer of the SplitQueue: minutes since the event was sent for review.
            'waiting_minutes' => $event->status === EventStatus::PendingReview && $event->getAttribute('submitted_at') instanceof CarbonImmutable
                ? (int) $event->getAttribute('submitted_at')->diffInMinutes(now()) : null,
            'organiser' => [
                'id' => $event->organiser_id,
                'username' => $event->organiser->username,
                'joined_at' => $event->organiser->created_at?->toIso8601String(),
                'approved_events' => $approved[$event->organiser_id] ?? 0,
            ],
            'going' => $counts[$event->id]['going'] ?? 0,
            'open_reports' => $reports[$event->id] ?? 0,
            'is_sample' => $event->is_sample,
        ], $events);
    }

    /**
     * @return array<string, mixed>
     */
    public static function detail(Event $event, Staff $staff): array
    {
        $event->loadMissing(['organiser.avatar', 'cover', 'reviewer']);
        self::auditPrivatePlace($event, $staff);
        $row = self::rows([$event])[0];
        $counts = app(Rsvps::class)->counts([$event->id])[$event->id];

        return [
            ...$row,
            'description' => $event->getAttribute('description'),
            'organiser_rules' => $event->getAttribute('organiser_rules'),
            'rules' => $event->rules ?? [],
            'capacity' => $event->capacity,
            'counts' => $counts,
            'place' => [
                'venue_name' => $event->getAttribute('venue_name'),
                'street' => $event->getAttribute('street'),
                'postcode' => $event->getAttribute('postcode'),
                'city' => $event->city,
                'country' => $event->getAttribute('country'),
                'lat' => $event->getAttribute('lat'),
                'lng' => $event->getAttribute('lng'),
            ],
            'cover' => MediaUrls::at($event->cover, 1080),
            'review' => [
                'reason' => $event->getAttribute('review_reason'),
                'reviewed_at' => $event->getAttribute('reviewed_at')?->toIso8601String(),
                'reviewed_by' => $event->reviewer?->name,
            ],
            'cancellation' => [
                'reason' => $event->getAttribute('cancellation_reason'),
                'cancelled_at' => $event->getAttribute('cancelled_at')?->toIso8601String(),
                'by_staff' => $event->getAttribute('cancelled_by_staff') === true,
            ],
            'removed_at' => $event->getAttribute('removed_at')?->toIso8601String(),
            'updates' => EventUpdate::query()->where('event_id', $event->id)->orderByDesc('created_at')->limit(20)->get()
                ->map(fn (EventUpdate $update): array => ['id' => $update->id, 'body' => $update->body, 'created_at' => $update->created_at?->toIso8601String()])->all(),
            'cases' => ModerationCase::query()->where('target_type', ReportTargetType::Event->value)->where('target_id', $event->id)->orderByDesc('created_at')->limit(20)->get(['id', 'status', 'created_at'])
                ->map(fn (ModerationCase $case): array => ['id' => $case->id, 'status' => $case->status->value, 'created_at' => $case->created_at?->toIso8601String()])->all(),
            'history' => AuditEvent::query()->where('target_type', $event->getMorphClass())->where('target_id', $event->id)->orderByDesc('id')->limit(30)->get()
                ->map(fn (AuditEvent $audit): array => ['action' => $audit->getAttribute('action'), 'reason' => $audit->getAttribute('reason'), 'actor_type' => $audit->getAttribute('actor_type'), 'occurred_at' => (string) $audit->getAttribute('occurred_at')])->all(),
            'can' => [
                'approve' => $staff->can('moderation.decide') && $event->status === EventStatus::PendingReview,
                'reject' => $staff->can('moderation.decide') && $event->status === EventStatus::PendingReview,
                'cancel' => $staff->can('moderation.decide') && $event->status === EventStatus::Published && ! $event->hasEnded(),
                'reopen' => $staff->can('moderation.decide') && $event->getAttribute('reviewed_by') !== null && $event->getAttribute('removed_at') === null
                    && ($event->status === EventStatus::Rejected || ($event->status === EventStatus::Published && $counts['going'] + $counts['interested'] + $counts['waitlist'] === 0)),
            ],
        ];
    }

    /**
     * The exact place of an after_rsvp event is personal data only the organiser and going members see (ADR-437 c): staff read it to
     * review it, and each first read of a day is in the audit log (a view of sensitive data, 06 §1), without the place itself.
     */
    private static function auditPrivatePlace(Event $event, Staff $staff): void
    {
        $exact = $event->getAttribute('street') !== null || $event->getAttribute('lat') !== null || $event->getAttribute('venue_name') !== null;

        if ($event->location_visibility !== EventLocationVisibility::AfterRsvp || ! $exact) {
            return;
        }

        if (Cache::add("admin:event-place-viewed:{$staff->getKey()}:{$event->id}", true, now()->endOfDay())) {
            Audit::record(EventAuditEvent::PrivatePlaceViewed->value, $event, null, null, null, $staff);
        }
    }

    /**
     * @param  list<string>  $ids
     * @return array<string, int>
     */
    private static function openReports(array $ids): array
    {
        if ($ids === []) {
            return [];
        }

        /** @var array<string, int> */
        return ModerationCase::query()->where('target_type', ReportTargetType::Event->value)->whereIn('target_id', $ids)
            ->whereIn('status', [CaseStatus::New->value, CaseStatus::InReview->value])
            ->groupBy('target_id')->selectRaw('target_id, count(*) as aggregate')->pluck('aggregate', 'target_id')
            ->map(fn (mixed $count): int => (int) $count)->all();
    }

    /**
     * @param  list<string>  $organisers
     * @return array<string, int>
     */
    private static function approvedCounts(array $organisers): array
    {
        if ($organisers === []) {
            return [];
        }

        /** @var array<string, int> */
        return Event::query()->whereIn('organiser_id', $organisers)->whereNotNull('published_at')
            ->groupBy('organiser_id')->selectRaw('organiser_id, count(*) as aggregate')->pluck('aggregate', 'organiser_id')
            ->map(fn (mixed $count): int => (int) $count)->all();
    }
}
