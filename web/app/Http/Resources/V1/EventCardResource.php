<?php

namespace App\Http\Resources\V1;

use App\Enums\EventLocationVisibility;
use App\Enums\EventStatus;
use App\Enums\EventType;
use App\Enums\EventVisibility;
use App\Enums\MediaStatus;
use App\Enums\ModerationStatus;
use App\Enums\RsvpStatus;
use App\Models\Event;
use App\Models\EventRsvp;
use App\Models\User;
use App\Services\Events\EventLocation;
use App\Services\Showcase\SampleContent;
use Illuminate\Http\Request;
use Illuminate\Http\Resources\Json\JsonResource;

/**
 * An EventCard of EVT-01, Entdecken and Home (09 §7.10). Lists never carry the exact place of an after_rsvp event — not even for the
 * organiser or a going member (09 §8.7): `location.exact` is false and only city and the area point are set; EVT-02 (GET events/{slug})
 * is where the exact place reaches those who may read it. Counts are real RSVPs, null on samples (09 §8.19). Prepared by EventPresenter.
 *
 * @property Event $resource
 */
class EventCardResource extends JsonResource
{
    /**
     * @return array<string, mixed>
     */
    public function toArray(Request $request): array
    {
        return $this->card($this->resource->location_visibility === EventLocationVisibility::Public);
    }

    /**
     * @return array<string, mixed>
     */
    protected function card(bool $exact): array
    {
        $event = $this->resource;
        $counts = $event->rsvpCounts ?? ['going' => 0, 'interested' => 0, 'waitlist' => 0];
        $sample = SampleContent::isSample($event);
        $mine = $event->relationLoaded('viewerRsvp') ? $event->getRelation('viewerRsvp') : null;
        $cover = $event->cover;
        $distance = $event->getAttribute('distance_km');

        return [
            'id' => $event->id,
            'slug' => $event->slug,
            'title' => $event->title,
            /** @var EventType */
            'type' => $event->type,
            /**
             * Published or cancelled for everybody else; the organiser also sees draft, pending_review and rejected.
             *
             * @var EventStatus
             */
            'status' => $event->status,
            /** @var EventVisibility */
            'visibility' => $event->visibility,
            /** ISO 8601 (UTC); show in `timezone`. */
            'starts_at' => $event->starts_at?->toIso8601String(),
            'ends_at' => $event->ends_at?->toIso8601String(),
            /** Always Europe/Berlin for now (09 §8.7). */
            'timezone' => (string) ($event->getAttribute('timezone') ?? 'Europe/Berlin'),
            /**
             * The place as far as this reader may see it (EventLocation): `exact` false means venue, street, postcode, lat and lng are
             * null and the app shows "Ort wird nach deiner Zusage angezeigt" with the city and the area point.
             *
             * @var array{visibility: 'public'|'after_rsvp', exact: bool, venue_name: string|null, street: string|null, postcode: string|null, city: string|null, country: string, lat: float|null, lng: float|null, area: array{lat: float|null, lng: float|null}}
             */
            'location' => EventLocation::present($event, $exact),
            'cover' => $cover !== null && $cover->status === MediaStatus::Ready && $cover->moderation_status !== ModerationStatus::Rejected ? new MediaResource($cover) : null,
            'organiser' => new EventOrganiserResource($event->organiser),
            /**
             * Real answers, members taken off the list left out; null on a sample event (09 §8.19: no invented counts).
             *
             * @var array{going: int, interested: int}|null
             */
            'counts' => $sample ? null : ['going' => $counts['going'], 'interested' => $counts['interested']],
            /** Null without a limit. */
            'capacity' => $event->capacity,
            /**
             * Spots left while a capacity is set (0 = new answers join the waitlist); null without a limit and on samples.
             *
             * @var int|null
             */
            'spots_left' => $event->capacity === null || $sample ? null : max(0, $event->capacity - $counts['going']),
            /** From the `near` point to the area point, whole km; only when the list was asked with `near`. */
            'distance_km' => is_numeric($distance) ? (int) $distance : null,
            /**
             * Up to three going members for the avatar row (09 §5 EventCard), by EVT-04's privacy rules: members only (empty for guests),
             * findable members, no block, never on a sample event. Next to `counts.going` for "38 Zusagen".
             *
             * @var list<MemberSummaryResource>
             */
            'attendee_preview' => array_map(fn (User $member): MemberSummaryResource => new MemberSummaryResource($member), $event->attendeePreview ?? []),
            /**
             * The reader's own answer, null without one (and for guests).
             *
             * @var RsvpStatus|null
             */
            'my_rsvp' => $mine instanceof EventRsvp && $mine->removed_at === null ? $mine->status : null,
            'is_sample' => $sample,
        ];
    }
}
