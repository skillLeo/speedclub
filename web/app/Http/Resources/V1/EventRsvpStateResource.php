<?php

namespace App\Http\Resources\V1;

use App\Enums\RsvpStatus;
use App\Models\Event;
use App\Models\EventRsvp;
use App\Services\Events\Rsvps;
use App\Services\Showcase\SampleContent;
use Illuminate\Http\Request;
use Illuminate\Http\Resources\Json\JsonResource;

/**
 * The answer of PUT/DELETE events/{slug}/rsvp: the reader's status (null after withdrawing), the waitlist place and the counts after
 * the change (null on samples). Going members get the event again through GET events/{slug} to read the exact place.
 *
 * @property array{event: Event, rsvp: EventRsvp|null, counts: array{going: int, interested: int, waitlist: int}} $resource
 */
class EventRsvpStateResource extends JsonResource
{
    /**
     * @return array<string, mixed>
     */
    public function toArray(Request $request): array
    {
        $event = $this->resource['event'];
        $rsvp = $this->resource['rsvp'];
        $counts = $this->resource['counts'];
        $sample = SampleContent::isSample($event);

        return [
            'event_id' => $event->id,
            /** @var RsvpStatus|null */
            'status' => $rsvp?->status,
            /**
             * Place on the waitlist (1 = next) while waiting; null otherwise.
             *
             * @var int|null
             */
            'waitlist_position' => $rsvp === null ? null : app(Rsvps::class)->position($rsvp),
            /** @var array{going: int, interested: int}|null */
            'counts' => $sample ? null : ['going' => $counts['going'], 'interested' => $counts['interested']],
            /**
             * Spots left while a capacity is set; null without a limit and on samples.
             *
             * @var int|null
             */
            'spots_left' => $event->capacity === null || $sample ? null : max(0, $event->capacity - $counts['going']),
        ];
    }
}
