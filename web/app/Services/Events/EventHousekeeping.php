<?php

namespace App\Services\Events;

use App\Enums\CollectionItemType;
use App\Enums\EventLocationVisibility;
use App\Enums\EventStatus;
use App\Enums\RsvpStatus;
use App\Jobs\Events\NotifyEventCancellation;
use App\Models\Event;
use App\Models\EventRsvp;
use App\Models\Media;
use App\Models\User;
use App\Services\Media\MediaService;
use App\Services\Social\Collections;
use Illuminate\Support\Facades\DB;

/**
 * Daily upkeep of events (events:housekeeping): cancelled and rejected events go after 12 months (09 §13 retention), past events after
 * past_retention_months, each with its cover; spots freed by deleted accounts go to the waitlist; the exact private place of an event over for
 * exact_place_retention_days goes (city and area point stay). And what an account closure (SET-13)
 * does to events at once: the member's answers go (their spots to the waitlist) and their upcoming events are cancelled, so attendees
 * are told rather than finding an empty car park.
 */
class EventHousekeeping
{
    public function __construct(
        private readonly MediaService $media,
        private readonly Rsvps $rsvps,
    ) {}

    /**
     * @return array{deleted: int, promoted: int, places_cleared: int}
     */
    public function run(): array
    {
        $deleted = 0;
        $old = Event::query()
            ->where(fn ($query) => $query
                ->where(fn ($q) => $q->whereIn('status', [EventStatus::Cancelled->value, EventStatus::Rejected->value])
                    ->where('updated_at', '<', now()->subMonths(config()->integer('speedclub.events.cancelled_retention_months'))))
                ->orWhere(fn ($q) => $q->where('status', EventStatus::Published->value)
                    ->where('ends_at', '<', now()->subMonths(config()->integer('speedclub.events.past_retention_months')))))
            ->where('is_sample', false)
            ->limit(500)
            ->get();

        foreach ($old as $event) {
            $this->delete($event);
            $deleted++;
        }

        // Security review note (ADR-113): a private (after_rsvp) place is kept only as long as attendees need it; after the event the city
        // and the area point stay, the exact venue goes.
        $cleared = Event::query()->where('location_visibility', EventLocationVisibility::AfterRsvp->value)->where('is_sample', false)
            ->where('ends_at', '<', now()->subDays(config()->integer('speedclub.events.exact_place_retention_days')))
            ->where(fn ($query) => $query->whereNotNull('street')->orWhereNotNull('venue_name')->orWhereNotNull('postcode')->orWhereNotNull('lat')->orWhereNotNull('lng'))
            ->limit(500)
            ->update(['venue_name' => null, 'street' => null, 'postcode' => null, 'lat' => null, 'lng' => null]);

        $promoted = 0;
        $open = Event::query()->where('status', EventStatus::Published->value)->whereNotNull('capacity')->where('ends_at', '>', now())
            ->whereExists(fn ($query) => $query->selectRaw('1')->from('event_rsvps')->whereColumn('event_rsvps.event_id', 'events.id')
                ->where('event_rsvps.status', RsvpStatus::Waitlist->value)->whereNull('event_rsvps.removed_at'))
            ->limit(500)->get();

        foreach ($open as $event) {
            $promoted += count($this->rsvps->locked($event, fn (Event $locked): array => $this->rsvps->fill($locked)));
        }

        return ['deleted' => $deleted, 'promoted' => $promoted, 'places_cleared' => $cleared];
    }

    /**
     * SET-13 / WEB-05: the member closed their account. Answers to upcoming events go; their own upcoming events are cancelled.
     */
    public function accountClosed(User $user): void
    {
        $answered = EventRsvp::query()->where('user_id', $user->id)->whereNull('removed_at')->pluck('event_id')->all();

        foreach (Event::query()->whereKey($answered)->get() as $event) {
            $this->rsvps->cancel($user, $event);
        }

        $upcoming = Event::query()->where('organiser_id', $user->id)
            ->whereIn('status', [EventStatus::Published->value, EventStatus::PendingReview->value])
            ->where('ends_at', '>', now())->get();

        foreach ($upcoming as $event) {
            DB::transaction(function () use ($event): void {
                $event->forceFill([
                    'status' => EventStatus::Cancelled,
                    'cancellation_reason' => (string) __('events.organiser_left', [], 'de'),
                    'cancelled_at' => now(),
                ])->save();
                $id = $event->id;
                DB::afterCommit(fn () => NotifyEventCancellation::dispatch($id));
            });
        }
    }

    public function delete(Event $event): void
    {
        $photos = Media::withTrashed()->where('mediable_type', $event->getMorphClass())->where('mediable_id', $event->id)->get();
        $event->delete();
        Collections::forgetItem(CollectionItemType::Event, $event->id);

        foreach ($photos as $photo) {
            $this->media->purge($photo);
        }
    }
}
