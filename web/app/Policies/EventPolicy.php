<?php

namespace App\Policies;

use App\Enums\ErrorCode;
use App\Enums\EventLocationVisibility;
use App\Enums\EventVisibility;
use App\Models\Event;
use App\Models\Follow;
use App\Models\User;
use App\Services\Showcase\SampleContent;
use Carbon\CarbonImmutable;
use Illuminate\Auth\Access\Response;

/**
 * Events (09 §8.7). Reading: the organiser always; anybody else only a published or cancelled event of an organiser they may see (no
 * block either way, publicly visible, samples only while shown), and a followers-only event only as a follower of the organiser or with
 * an answer of their own. Organising: verified e-mail and an account at least 14 days old (03 creation rights); publishing restrictions
 * are the route's not-restricted:publishing. Answering: verified, active, not the own event.
 */
class EventPolicy
{
    public function view(?User $viewer, Event $event): bool
    {
        if ($viewer !== null && $event->isOrganisedBy($viewer)) {
            return ! $viewer->isDeactivated();
        }

        if (! $event->status->isPublic() || $event->getAttribute('removed_at') !== null || app(SampleContent::class)->hides($event, $viewer)) {
            return false;
        }

        $organiser = $event->organiser;

        if (! $organiser->isPubliclyVisible() || ($viewer !== null && $viewer->hasBlockWith($organiser))) {
            return false;
        }

        if ($event->visibility !== EventVisibility::Followers) {
            return true;
        }

        return $viewer !== null && (
            Follow::query()->where('follower_id', $viewer->id)->where('followee_id', $organiser->id)->exists()
            || $event->rsvps()->where('user_id', $viewer->id)->whereNull('removed_at')->exists()
        );
    }

    public function create(User $user): Response|bool
    {
        if (! $user->isActive()) {
            return false;
        }

        if (! $user->hasVerifiedEmail()) {
            return Response::deny(code: ErrorCode::EmailNotVerified->value);
        }

        return self::eligibleAt($user)->isPast() ? true : Response::deny(code: ErrorCode::OrganiserNotEligible->value);
    }

    /**
     * Edit, submit, cancel, post updates, remove attendees: the organiser, while active.
     */
    public function update(User $user, Event $event): bool
    {
        return $event->isOrganisedBy($user) && $user->isActive() && $event->getAttribute('removed_at') === null;
    }

    public function delete(User $user, Event $event): bool
    {
        return $event->isOrganisedBy($user) && ! $user->isDeactivated();
    }

    public function rsvp(User $user, Event $event): Response|bool
    {
        if (! $user->isActive() || $event->isOrganisedBy($user) || ! $this->view($user, $event)) {
            return false;
        }

        return $user->hasVerifiedEmail() ? true : Response::deny(code: ErrorCode::EmailNotVerified->value);
    }

    /**
     * Organiser updates: the organiser and members with an answer (not taken off the list). Security review L2: for an after_rsvp place
     * only going members, as updates often name the meeting point.
     */
    public function viewUpdates(User $user, Event $event): bool
    {
        if (! $this->view($user, $event)) {
            return false;
        }

        if ($event->isOrganisedBy($user)) {
            return true;
        }

        return $event->location_visibility === EventLocationVisibility::AfterRsvp
            ? $user->isActive() && $event->isGoing($user)
            : $event->rsvps()->where('user_id', $user->id)->whereNull('removed_at')->exists();
    }

    /**
     * 09 §8.7: an organiser's account is at least this old.
     */
    public static function eligibleAt(User $user): CarbonImmutable
    {
        $created = $user->getAttribute('created_at');

        return CarbonImmutable::parse($created ?? now())->addDays(config()->integer('speedclub.events.organiser_min_account_days'));
    }
}
