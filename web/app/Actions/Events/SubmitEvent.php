<?php

namespace App\Actions\Events;

use App\Enums\ErrorCode;
use App\Enums\EventLocationVisibility;
use App\Enums\EventRule;
use App\Enums\EventStatus;
use App\Exceptions\ApiException;
use App\Models\Event;
use App\Models\User;
use Illuminate\Support\Facades\DB;

/**
 * "Zur Prüfung senden" / "Veröffentlichen" (09 §8.7): a draft (or a rejected event after changes) needs a title, a future start, an
 * end, a city with a pin and the legal_only rule. It goes to pre-moderation (ADM-53) when the organiser has fewer than
 * premoderate_first approved events or the place is after_rsvp; otherwise it is published at once (post-moderation, reportable).
 */
class SubmitEvent
{
    public function handle(User $user, Event $event): Event
    {
        return DB::transaction(function () use ($user, $event): Event {
            /** @var Event $locked */
            $locked = Event::query()->whereKey($event->id)->lockForUpdate()->firstOrFail();

            if (! $locked->status->isEditableDraft() || $locked->getAttribute('removed_at') !== null) {
                throw new ApiException(ErrorCode::EventClosed);
            }

            $this->assertComplete($locked);

            $review = $this->needsReview($user, $locked);
            $locked->forceFill([
                'status' => $review ? EventStatus::PendingReview : EventStatus::Published,
                'submitted_at' => now(),
                'published_at' => $review ? null : now(),
                'review_reason' => null,
                'reviewed_by' => null,
                'reviewed_at' => null,
            ])->save();

            return $locked;
        });
    }

    public function needsReview(User $user, Event $event): bool
    {
        if ($event->location_visibility === EventLocationVisibility::AfterRsvp) {
            return true;
        }

        // Security review L4: only events that stayed out: not removed by moderation, not rejected after a re-review.
        $approved = Event::query()->where('organiser_id', $user->id)->whereNotNull('published_at')->whereNull('removed_at')
            ->where('status', '!=', EventStatus::Rejected->value)->where('id', '!=', $event->id)->count();

        return $approved < config()->integer('speedclub.events.premoderate_first');
    }

    /**
     * @throws ApiException 422 naming every missing field
     */
    private function assertComplete(Event $event): void
    {
        $errors = [];
        $required = (string) __('events.required_to_submit');

        foreach (['starts_at', 'ends_at', 'city', 'lat', 'lng'] as $field) {
            if ($event->getAttribute($field) === null || $event->getAttribute($field) === '') {
                $errors[$field] = [$required];
            }
        }

        if ($event->starts_at !== null && $event->starts_at->isPast()) {
            $errors['starts_at'] = [(string) __('events.starts_in_past')];
        }

        if (! in_array(EventRule::LegalOnly->value, $event->rules ?? [], true)) {
            $errors['rules'] = [(string) __('events.legal_only_required')];
        }

        if ($errors !== []) {
            throw new ApiException(ErrorCode::ValidationFailed, errors: $errors);
        }

        EventFields::assertTimes($event);
    }
}
