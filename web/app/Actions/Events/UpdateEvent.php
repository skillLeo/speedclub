<?php

namespace App\Actions\Events;

use App\Enums\ErrorCode;
use App\Enums\EventStatus;
use App\Exceptions\ApiException;
use App\Http\RateLimits;
use App\Jobs\Events\NotifyEventChange;
use App\Models\Event;
use App\Services\Events\Rsvps;
use App\Services\Rules\ContentScreen;
use Carbon\CarbonImmutable;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\RateLimiter;

/**
 * EVT-03 / EVT-06 "Bearbeiten": the organiser changes an event that is not over and not cancelled. A change of time or place of a published
 * event tells everybody with an answer (NotifyEventAttendees, "changed"), at most changes_per_hour times an hour per event. The place's
 * visibility is fixed once the event was sent for review (an after_rsvp place is why it was reviewed).
 *
 * Security review SEC-412-01: nothing changes while staff review the event (409 event_in_review), and a published event that needed
 * pre-moderation (a private place, or one of the organiser's first events) goes back to review when its title, description, place or
 * cover change, with the changed fields in review_changes for ADM-53. Other published events stay published (post-moderation).
 */
class UpdateEvent
{
    /** Time and place: attendees are told. */
    private const MATERIAL = ['starts_at', 'ends_at', 'venue_name', 'street', 'postcode', 'city', 'lat', 'lng'];

    /** What staff approved: a change sends a pre-moderated event back to review. */
    public const REVIEWED = ['title', 'description', 'venue_name', 'street', 'postcode', 'city', 'lat', 'lng'];

    public function __construct(
        private readonly Rsvps $rsvps,
        private readonly SubmitEvent $submit,
    ) {}

    /**
     * @param  array<string, mixed>  $data  validated UpdateEventRequest data
     */
    public function handle(Event $event, array $data): Event
    {
        $flags = EventFields::screen($data);

        $updated = $this->rsvps->locked($event, function (Event $locked) use ($data): Event {
            self::assertEditable($locked);

            if (array_key_exists('location_visibility', $data) && $data['location_visibility'] !== $locked->location_visibility->value && ! $locked->status->isEditableDraft()) {
                throw new ApiException(ErrorCode::ValidationFailed, errors: ['location_visibility' => [(string) __('events.location_visibility_locked')]]);
            }

            $capacityBefore = $locked->capacity;
            EventFields::fill($locked, $data);
            $material = $locked->status === EventStatus::Published && $locked->isDirty(self::MATERIAL);

            if ($material) {
                $this->countChange($locked);
            }

            if ($locked->isDirty('starts_at')) {
                $this->rearmReminders($locked);
            }

            $this->reviewAgainIfNeeded($locked, array_keys(array_intersect_key($locked->getDirty(), array_flip(self::REVIEWED))));
            $locked->save();

            if ($locked->status === EventStatus::Published && ($capacityBefore !== null && ($locked->capacity === null || $locked->capacity > $capacityBefore))) {
                $this->rsvps->fill($locked);
            }

            // Back in review: attendees hear about the new time or place with the approval (ReviewEvent).
            if ($material && $locked->status === EventStatus::Published) {
                $id = $locked->id;
                $token = (string) now()->getTimestampMs();
                DB::afterCommit(fn () => NotifyEventChange::dispatch($id, $token));
            }

            return $locked;
        });

        app(ContentScreen::class)->flagAfterCommit($flags, $updated);

        return $updated;
    }

    /**
     * Over, cancelled or removed: 409 event_closed; with staff for review: 409 event_in_review (also for a new cover, UploadEventCover).
     */
    public static function assertEditable(Event $event): void
    {
        if ($event->status === EventStatus::Cancelled || $event->hasEnded() || $event->getAttribute('removed_at') !== null) {
            throw new ApiException(ErrorCode::EventClosed);
        }

        if ($event->status === EventStatus::PendingReview) {
            throw new ApiException(ErrorCode::EventInReview);
        }
    }

    /**
     * A published event that needed pre-moderation goes back to it when something staff approved changed ($changed, field names; "cover"
     * from UploadEventCover). The event leaves the lists until staff decide again; answers stay.
     *
     * @param  list<string>  $changed
     */
    public function reviewAgainIfNeeded(Event $event, array $changed): void
    {
        if ($changed === [] || $event->status !== EventStatus::Published || ! $this->submit->needsReview($event->organiser, $event)) {
            return;
        }

        $before = is_array($event->getAttribute('review_changes')) ? $event->getAttribute('review_changes') : [];
        $event->forceFill([
            'status' => EventStatus::PendingReview,
            'submitted_at' => now(),
            'review_changes' => array_values(array_unique([...array_filter($before, is_string(...)), ...$changed])),
            'review_reason' => null,
            'reviewed_by' => null,
            'reviewed_at' => null,
        ]);
    }

    /**
     * SEC-412-02: every change of time or place reaches every attendee, so it is counted per event (not per request).
     */
    private function countChange(Event $event): void
    {
        $key = 'event-changes:'.$event->id;
        $max = config()->integer('speedclub.events.changes_per_hour');

        if (RateLimiter::tooManyAttempts($key, $max)) {
            throw RateLimits::tooMany('event_changes', ['Retry-After' => RateLimiter::availableIn($key)]);
        }

        RateLimiter::hit($key, 3600);
    }

    /**
     * A moved start re-arms a reminder kind only when the new reminder moment is at least reminder_rearm_hours after the last reminder of
     * that kind (SEC-412-02): moving an event back and forth around its start cannot repeat the 24 h or 2 h reminder.
     */
    private function rearmReminders(Event $event): void
    {
        $start = $event->starts_at;
        $gap = config()->integer('speedclub.events.reminder_rearm_hours');

        foreach (['24h' => 24, '2h' => 2] as $kind => $hours) {
            $column = 'reminded_'.$kind.'_at';
            $last = $event->getAttribute($column);

            if (! $last instanceof CarbonImmutable || $start === null || $start->subHours($hours)->greaterThanOrEqualTo($last->addHours($gap))) {
                $event->forceFill([$column => null]);
            }
        }
    }
}
