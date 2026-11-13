<?php

namespace App\Actions\Admin\Events;

use App\Actions\Events\CancelEvent;
use App\Enums\ErrorCode;
use App\Enums\EventAuditEvent;
use App\Enums\EventStatus;
use App\Exceptions\ApiException;
use App\Jobs\Events\NotifyEventChange;
use App\Models\Event;
use App\Models\Staff;
use App\Services\Audit\Audit;
use App\Services\Notifications\Notifier;
use Illuminate\Support\Facades\DB;

/**
 * ADM-53/54 pre-moderation (09 §8.7, §10.2 SplitQueue): staff approve a pending event (published at once) or reject it with a reason the
 * organiser reads; reopen puts a decision back into the queue (the SplitQueue's undo, or a second look) while nobody answered yet.
 * Every decision is audited with the reason; the organiser is told after the commit.
 *
 * Optimistic locking (ADR-439, M4.17 ADM-53/54): every staff write names the `version` it decided on. When the event changed since,
 * nothing happens: 409 edit_conflict ("changed meanwhile", the page reloads it). A version that still matches but a state that no longer
 * allows the action (decided by somebody else in the same second, the event ended) is 409 event_closed.
 */
class ReviewEvent
{
    public function __construct(private readonly Notifier $notifier) {}

    /**
     * $seen: the version (updated_at, ISO 8601) of the event the staff member looked at. Security review SEC-412-01: when the event changed
     * since, nothing is approved (409 edit_conflict; the page reloads), so staff never approve a version they did not see.
     */
    public function approve(Staff $staff, Event $event, ?string $reason = null, ?string $seen = null): Event
    {
        return $this->decide($staff, $event, true, $reason, $seen);
    }

    /**
     * The version ADM-53/54 hand back with an approval.
     */
    public static function version(Event $event): ?string
    {
        return $event->updated_at?->toIso8601String();
    }

    /**
     * $seen as for approve. Without it (the M4.12 callers) the version is not compared; the admin always sends it.
     */
    public function reject(Staff $staff, Event $event, string $reason, ?string $seen = null): Event
    {
        return $this->decide($staff, $event, false, $reason, $seen, $seen !== null);
    }

    /**
     * ADM-54 "Absagen" by staff: CancelEvent (audit, attendees and organiser told) on the version the staff member saw.
     */
    public function cancel(Staff $staff, Event $event, string $reason, string $seen): Event
    {
        return DB::transaction(function () use ($staff, $event, $reason, $seen): Event {
            $this->guard($this->lock($event), $seen);

            return app(CancelEvent::class)->handle($event, $reason, $staff);
        });
    }

    /**
     * Back to pending_review from a staff decision: an approved event nobody answered yet, or a rejected one (not a moderation removal).
     * $seen as for reject.
     */
    public function reopen(Staff $staff, Event $event, ?string $reason = null, ?string $seen = null): Event
    {
        return DB::transaction(function () use ($staff, $event, $reason, $seen): Event {
            $locked = $this->lock($event);

            if ($seen !== null) {
                $this->guard($locked, $seen);
            }
            $reopenable = ($locked->status === EventStatus::Published && $locked->getAttribute('reviewed_by') !== null && ! $locked->rsvps()->exists())
                || ($locked->status === EventStatus::Rejected && $locked->getAttribute('removed_at') === null && $locked->getAttribute('reviewed_by') !== null);

            if (! $reopenable) {
                throw new ApiException(ErrorCode::EventClosed);
            }

            $before = $locked->status->value;
            $locked->forceFill(['status' => EventStatus::PendingReview, 'published_at' => null, 'review_reason' => null, 'reviewed_by' => null, 'reviewed_at' => null])->save();
            Audit::record(EventAuditEvent::Reopened->value, $locked, ['status' => $before], ['status' => EventStatus::PendingReview->value], $reason, $staff);

            return $locked;
        });
    }

    private function decide(Staff $staff, Event $event, bool $approve, ?string $reason, ?string $seen = null, bool $compare = true): Event
    {
        $changes = [];
        $decided = DB::transaction(function () use ($staff, $event, $approve, $reason, $seen, $compare, &$changes): Event {
            $locked = $this->lock($event);

            // An approval is always bound to a version (SEC-412-01); a rejection when the caller names one.
            if ($approve || $compare) {
                $this->guard($locked, $seen);
            }

            if ($locked->status !== EventStatus::PendingReview) {
                throw new ApiException(ErrorCode::EventClosed);
            }

            $changes = is_array($locked->getAttribute('review_changes')) ? $locked->getAttribute('review_changes') : [];
            $locked->forceFill([
                'status' => $approve ? EventStatus::Published : EventStatus::Rejected,
                // An event back in review after changes keeps its first publication date.
                'published_at' => $approve ? ($locked->getAttribute('published_at') ?? now()) : null,
                'review_changes' => null,
                'review_reason' => $approve ? null : $reason,
                'reviewed_by' => $staff->id,
                'reviewed_at' => now(),
            ])->save();

            Audit::record(
                ($approve ? EventAuditEvent::Approved : EventAuditEvent::Rejected)->value,
                $locked,
                ['status' => EventStatus::PendingReview->value],
                ['status' => $locked->status->value],
                $reason,
                $staff,
            );

            return $locked;
        });

        $this->notifier->eventReviewed($decided->organiser, $decided, $approve, $reason);

        // A published event that went back to review for a new place: its attendees hear about it now that it is approved (UpdateEvent).
        if ($approve && array_intersect($changes, ['venue_name', 'street', 'postcode', 'city', 'lat', 'lng']) !== []) {
            NotifyEventChange::dispatch($decided->id, (string) now()->getTimestampMs());
        }

        return $decided;
    }

    /**
     * 409 edit_conflict when the event is no longer the version the staff member decided on (or they named none).
     */
    private function guard(Event $locked, ?string $seen): void
    {
        if ($seen === null || $seen !== self::version($locked)) {
            throw new ApiException(ErrorCode::EditConflict);
        }
    }

    private function lock(Event $event): Event
    {
        /** @var Event */
        return Event::query()->whereKey($event->id)->lockForUpdate()->firstOrFail();
    }
}
