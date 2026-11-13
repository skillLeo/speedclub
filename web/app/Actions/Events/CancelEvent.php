<?php

namespace App\Actions\Events;

use App\Enums\ErrorCode;
use App\Enums\EventAuditEvent;
use App\Enums\EventStatus;
use App\Exceptions\ApiException;
use App\Jobs\Events\NotifyEventCancellation;
use App\Models\Event;
use App\Models\Staff;
use App\Services\Audit\Audit;
use App\Services\Events\Rsvps;
use App\Services\Notifications\Notifier;
use Illuminate\Support\Facades\DB;

/**
 * EVT-06 "Absagen" with a reason (09 §7.10): a published event that has not ended, or one waiting for review, is cancelled and stays
 * readable with the reason; everybody with an answer is told (NotifyEventAttendees). Staff cancel through ADM-54 with a reason, audited,
 * and the organiser is told too.
 */
class CancelEvent
{
    public function __construct(
        private readonly Rsvps $rsvps,
        private readonly Notifier $notifier,
    ) {}

    public function handle(Event $event, string $reason, ?Staff $staff = null): Event
    {
        return $this->rsvps->locked($event, function (Event $locked) use ($reason, $staff): Event {
            $cancellable = ($locked->status === EventStatus::Published && ! $locked->hasEnded()) || $locked->status === EventStatus::PendingReview;

            if (! $cancellable || $locked->getAttribute('removed_at') !== null) {
                throw new ApiException(ErrorCode::EventClosed);
            }

            $before = $locked->status->value;
            $locked->forceFill([
                'status' => EventStatus::Cancelled,
                'cancellation_reason' => $reason,
                'cancelled_at' => now(),
                'cancelled_by_staff' => $staff !== null,
            ])->save();

            $id = $locked->id;
            DB::afterCommit(fn () => NotifyEventCancellation::dispatch($id));

            if ($staff !== null) {
                $organiser = $locked->organiser;
                DB::afterCommit(fn () => $this->notifier->eventCancelled($organiser, $locked, true));
                Audit::record(EventAuditEvent::CancelledByStaff->value, $locked, ['status' => $before], ['status' => EventStatus::Cancelled->value], $reason, $staff);
            }

            return $locked;
        });
    }
}
