<?php

namespace App\Http\Resources\V1;

use App\Actions\Events\SubmitEvent;
use App\Enums\EventRule;
use App\Enums\EventStatus;
use App\Models\Event;
use App\Models\EventRsvp;
use App\Models\User;
use App\Services\Events\EventCalendar;
use App\Services\Events\EventLocation;
use App\Services\Events\Rsvps;
use App\Support\Viewer;
use Illuminate\Http\Request;
use Illuminate\Support\Facades\Gate;

/**
 * EVT-02 Treffen-Detail (09 §7.10) and the data of the public page WEB-09: the card plus description, rules, cancellation, the
 * reader's answer with the waitlist place, what the reader may do, and the calendar link. The exact place only for the organiser and
 * going members of an after_rsvp event (EventLocation::exactFor). The organiser also reads the review state.
 *
 * @property Event $resource
 */
class EventResource extends EventCardResource
{
    /**
     * @return array<string, mixed>
     */
    public function toArray(Request $request): array
    {
        $event = $this->resource;
        $viewer = Viewer::from($request);
        $organiser = $event->isOrganisedBy($viewer);
        $mine = $viewer === null ? null : $event->rsvpOf($viewer);
        $mine = $mine instanceof EventRsvp && $mine->removed_at === null ? $mine : null;
        $gate = Gate::forUser($viewer);
        $exact = EventLocation::exactFor($event, $viewer);
        $rules = is_array($event->rules) ? array_values(array_filter(array_map(fn (mixed $rule): ?EventRule => EventRule::tryFrom((string) $rule), $event->rules))) : [];

        return [
            ...$this->card($exact),
            /** @var string|null */
            'description' => $event->getAttribute('description'),
            /**
             * The organiser's own rules, shown under the community rules.
             *
             * @var string|null
             */
            'organiser_rules' => $event->getAttribute('organiser_rules'),
            /**
             * The rules checklist the organiser accepted (legal_only always).
             *
             * @var list<EventRule>
             */
            'rules' => $rules,
            /**
             * Why the event was cancelled; null unless cancelled.
             *
             * @var string|null
             */
            'cancellation_reason' => $event->status === EventStatus::Cancelled ? $event->getAttribute('cancellation_reason') : null,
            'cancelled_at' => $event->getAttribute('cancelled_at')?->toIso8601String(),
            /** Cancelled by staff rather than the organiser. */
            'cancelled_by_staff' => $event->status === EventStatus::Cancelled && $event->getAttribute('cancelled_by_staff') === true,
            /**
             * Place on the waitlist (1 = next), only while the reader is waiting.
             *
             * @var int|null
             */
            'waitlist_position' => $mine === null ? null : app(Rsvps::class)->position($mine),
            /**
             * What the reader may do now; the app shows only those actions.
             *
             * @var array{rsvp: bool, edit: bool, cancel: bool, post_update: bool, view_updates: bool, view_attendees: bool, report: bool}
             */
            'can' => [
                'rsvp' => $viewer !== null && $event->isOpen() && $gate->allows('rsvp', $event),
                'edit' => $organiser && $gate->allows('update', $event) && ! $event->hasEnded() && $event->status !== EventStatus::Cancelled,
                'cancel' => $organiser && $gate->allows('update', $event) && $event->isOpen(),
                'post_update' => $organiser && $gate->allows('update', $event) && $event->isOpen(),
                'view_updates' => $viewer !== null && $gate->allows('viewUpdates', $event),
                'view_attendees' => $viewer !== null && $event->status->isPublic(),
                'report' => $viewer !== null && ! $organiser,
            ],
            /**
             * The organiser's review state: submitted_at, reviewed_at and the reason of a rejection. `will_be_reviewed` (a draft or a
             * rejected event): sending it goes to the team's review first (the first events, every after_rsvp event), so EVT-03 says
             * "Zur Prüfung senden" rather than "Veröffentlichen". `was_premoderated` (a published event): the team approved it before it
             * went live. Null for everybody else.
             *
             * @var array{submitted_at: string|null, reviewed_at: string|null, reason: string|null, will_be_reviewed: bool, was_premoderated: bool}|null
             */
            'review' => $organiser ? [
                'submitted_at' => $event->getAttribute('submitted_at')?->toIso8601String(),
                'reviewed_at' => $event->getAttribute('reviewed_at')?->toIso8601String(),
                'reason' => $event->status === EventStatus::Rejected ? $event->getAttribute('review_reason') : null,
                'will_be_reviewed' => $event->status->isEditableDraft() && $viewer instanceof User && app(SubmitEvent::class)->needsReview($viewer, $event),
                'was_premoderated' => $event->status === EventStatus::Published && $event->getAttribute('reviewed_at') !== null,
            ] : null,
            /**
             * "In Kalender": an .ics URL. For the organiser and going members of an after_rsvp event a signed link with the exact place
             * (valid until two days after the end); otherwise the public file with the area only.
             */
            'calendar_url' => $event->status->isPublic() ? app(EventCalendar::class)->urlFor($event, $viewer instanceof User && $exact ? $viewer : null) : null,
            /** The public page WEB-09 (/e/{slug}) for "Teilen". */
            'share_url' => url('/e/'.$event->slug),
            'created_at' => $event->created_at?->toIso8601String(),
        ];
    }
}
