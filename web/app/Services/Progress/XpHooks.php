<?php

namespace App\Services\Progress;

use App\Enums\VehicleStatus;
use App\Enums\XpType;
use App\Models\BuildUpdate;
use App\Models\Event;
use App\Models\ForumPost;
use App\Models\ForumThread;
use App\Models\Spot;
use App\Models\User;
use App\Models\Vehicle;
use App\Models\XpEvent;
use App\Services\Badges\BadgeAwarder;
use App\Services\BuildScore\BuildScoreInputs;
use App\Services\Forum\ForumPremoderation;

/**
 * Where the real actions of the app meet the XP ledger (m5.9d contract §1). Each hook awards once per source and then queues the member's
 * badge check. Samples never earn anything for real members: a sample car, its owner or a sample member earn and give nothing.
 *
 * Callers: PublishVehicle (first car published), RecomputeBuildScore (documented mods, the Build Score's rule), PostBuildUpdate and
 * AddBuildNote (build update; one a day earns, `xp.types.build_update.daily_max`), RecordSpot (new spot: the member's first counted
 * spot of that car), DexSets (set completed), RemoveSpots (staff removal takes the spot's event back), CheckInToEvent (event check-in),
 * MarkForumSolution (answer marked "Gelöst") and VoteForumPost ("Hilfreich" received) (SEC-P5-14).
 */
final class XpHooks
{
    public function __construct(
        private readonly Xp $xp,
        private readonly BadgeAwarder $badges,
        private readonly BuildScoreInputs $inputs,
        private readonly ForumPremoderation $premoderation,
    ) {}

    /** 50 XP for the member's first published car, once per member (ref: the member). */
    public function firstVehiclePublished(Vehicle $vehicle): void
    {
        $owner = $this->realOwner($vehicle);

        if ($owner !== null && $vehicle->getAttribute('published_at') !== null) {
            $this->award($owner, XpType::FirstVehicle, 'user', $owner->id);
        }
    }

    /** 20 XP for each documented mod of a published car, once per mod (the same rule as the Build Score). */
    public function documentedMods(string $vehicleId): void
    {
        $vehicle = Vehicle::query()->find($vehicleId);

        if (! $vehicle instanceof Vehicle || $vehicle->status !== VehicleStatus::Published) {
            return;
        }

        $owner = $this->realOwner($vehicle);

        if ($owner === null) {
            return;
        }

        $awarded = false;

        foreach ($this->inputs->documentedModIds($vehicle) as $modId) {
            $awarded = $this->xp->award($owner, XpType::DocumentedMod, 'modification', $modId) !== null || $awarded;
        }

        if ($awarded) {
            $this->badges->queue($owner);
        }
    }

    /** 15 XP for a build update (post or note) of a published car; the type's day maximum lets one a day earn. */
    public function buildUpdatePosted(BuildUpdate $update): void
    {
        $vehicle = Vehicle::query()->find($update->vehicle_id);

        if (! $vehicle instanceof Vehicle || $vehicle->status !== VehicleStatus::Published || $update->getAttribute('is_sample') === true) {
            return;
        }

        $owner = $this->realOwner($vehicle);

        if ($owner !== null) {
            $this->award($owner, XpType::BuildUpdate, 'build_update', (string) $update->id);
        }
    }

    /**
     * 10 XP for the member's first counted spot of a car (ref: that spot, so staff removing it takes the XP back). A later spot of the
     * same car earns nothing; a sample car gives nothing.
     */
    public function spotCounted(User $spotter, Spot $spot, Vehicle $vehicle): void
    {
        if (! $spot->counted || $vehicle->getAttribute('is_sample') === true || $this->realOwner($vehicle) === null) {
            return;
        }

        $earned = XpEvent::query()
            ->where('xp_events.user_id', $spotter->id)
            ->where('xp_events.type', XpType::NewSpot->value)
            ->where('xp_events.ref_type', 'spot')
            ->join('spots', 'spots.id', '=', 'xp_events.ref_id')
            ->where('spots.vehicle_id', $vehicle->id)
            ->exists();

        if (! $earned) {
            $this->award($spotter, XpType::NewSpot, 'spot', (string) $spot->id);
        }

        // Street Famous belongs to the car's owner.
        $owner = $this->realOwner($vehicle);

        if ($owner !== null) {
            $this->badges->queue($owner);
        }
    }

    /** Staff removed a spot (abuse): the XP it earned goes; badges stay. */
    public function spotRemoved(Spot $spot): void
    {
        $this->xp->revoke(XpType::NewSpot, 'spot', (string) $spot->id);
    }

    /** 100 XP for a completed STREET DEX set, once per set and period (a season set each year). */
    public function setCompleted(User $member, string $setKey, string $period): void
    {
        $this->award($member, XpType::SetCompleted, 'dex_set', $period === '' ? $setKey : $setKey.':'.$period);
    }

    /** SEC-P5G-05: staff removed the spots a completed set rested on (abuse): its 100 XP go with the completion. */
    public function setRevoked(User $member, string $setKey, string $period): void
    {
        $this->xp->revoke(XpType::SetCompleted, 'dex_set', $period === '' ? $setKey : $setKey.':'.$period);
    }

    /** M5.6: 40 XP for a check-in at an event, once per member and event. A sample event gives nothing. */
    public function eventCheckedIn(User $member, Event $event): void
    {
        if ($event->is_sample || $event->isOrganisedBy($member)) {
            return;
        }

        $this->award($member, XpType::EventCheckin, 'event', $event->id);
    }

    /**
     * M5.8: 30 XP when the member's answer is marked as the solution of a thread, once per thread (ref: the answer; marking another
     * answer later earns nothing more, so two accounts cannot farm one thread). Nothing for an answer in one's own thread, for samples,
     * or while the thread's author is still inside the forum's pre-moderation window (fresh accounts marking each other, SEC-P5-14).
     */
    public function forumSolution(ForumThread $thread, ForumPost $answer): void
    {
        $author = $answer->user;
        $asker = $thread->user;

        if (! $author instanceof User || ! $asker instanceof User || $thread->isAuthoredBy($author) || $answer->thread_id !== $thread->id
            || $answer->is_sample || $thread->is_sample || $this->premoderation->needsReview($asker)) {
            return;
        }

        $earned = XpEvent::query()
            ->where('xp_events.type', XpType::ForumSolution->value)
            ->where('xp_events.ref_type', 'forum_answer')
            ->join('forum_posts', 'forum_posts.id', '=', 'xp_events.ref_id')
            ->where('forum_posts.thread_id', $thread->id)
            ->exists();

        if (! $earned) {
            $this->award($author, XpType::ForumSolution, 'forum_answer', $answer->id);
        }
    }

    /**
     * M5.8: 2 XP for each "Hilfreich" the member's reply receives (at most 20 a day), once per voter and reply (ref: reply and voter, so
     * taking a vote back and giving it again earns nothing). Never for one's own reply, a sample, or a voter still inside the forum's
     * pre-moderation window (fresh accounts voting each other up). Never for likes or reactions.
     */
    public function helpfulReceived(ForumPost $post, User $voter): void
    {
        $author = $post->user;

        if (! $author instanceof User || $author->id === $voter->id || $post->is_sample || $voter->getAttribute('is_sample') === true
            || $this->premoderation->needsReview($voter)) {
            return;
        }

        $this->award($author, XpType::HelpfulReceived, 'forum_vote', $post->id.':'.$voter->id);
    }

    private function award(User $member, XpType $type, string $refType, string $refId): void
    {
        if ($this->xp->award($member, $type, $refType, $refId) !== null) {
            $this->badges->queue($member);
        }
    }

    /** The car's owner when the owner may earn (a real member) and the car is no sample. */
    private function realOwner(Vehicle $vehicle): ?User
    {
        if ($vehicle->getAttribute('is_sample') === true) {
            return null;
        }

        $owner = User::query()->find($vehicle->owner_id);

        return $owner instanceof User && Xp::eligible($owner) ? $owner : null;
    }
}
