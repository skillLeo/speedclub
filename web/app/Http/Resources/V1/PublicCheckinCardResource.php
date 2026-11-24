<?php

namespace App\Http\Resources\V1;

use App\Models\EventCheckin;
use Illuminate\Http\Request;
use Illuminate\Http\Resources\Json\JsonResource;

/**
 * M5.6 a row of GET public/users/{username}/checkins ("War dabei" on PROF-01/02): an ended event as an EventCard without the reader's
 * answer (`my_rsvp`), and the Berlin date of the check-in only, never the time (nothing live, 10 §16).
 *
 * @property EventCheckin $resource
 */
class PublicCheckinCardResource extends JsonResource
{
    /**
     * @return array<string, mixed>
     */
    public function toArray(Request $request): array
    {
        $card = (new EventCardResource($this->resource->event))->toArray($request);
        unset($card['my_rsvp']);

        return [
            ...$card,
            /** YYYY-MM-DD in Europe/Berlin. */
            'checked_in_on' => $this->resource->checked_in_at->setTimezone(config()->string('speedclub.notifications.timezone'))->toDateString(),
        ];
    }
}
