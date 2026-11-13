<?php

namespace App\Services\Moderation;

use App\Enums\CommentStatus;
use App\Enums\DecisionAction;
use App\Enums\DecisionRestriction;
use App\Enums\EventStatus;
use App\Enums\ModerationStatus;
use App\Enums\ReportTargetType;
use App\Enums\UserStatus;
use App\Enums\Visibility;
use App\Models\BuildUpdate;
use App\Models\Comment;
use App\Models\Decision;
use App\Models\Event;
use App\Models\Media;
use App\Models\Message;
use App\Models\ModerationCase;
use App\Models\Modification;
use App\Models\User;
use App\Models\Vehicle;
use App\Services\Media\MediaService;
use App\Services\PublicPages\OgImages;
use App\Services\PublicPages\SitemapWriter;
use App\Services\Search\VehicleSearchProjector;
use Closure;
use DomainException;

/**
 * The undo of a decision, for a `reverse` decision (m3.2-contract §1; DecideCase is its only caller):
 *
 * - restrict / suspend: the account's restriction goes when the account still holds it for this decision (a later decision that
 *   outlasts it keeps its own); a lifted suspension makes the member active again;
 * - remove_content: what ContentRemoval did is undone from the snapshot taken before it (decisions.restore): a photo is usable again
 *   and its variants are drawn again from the private original (ADR-123); a profile gets its name, text and pictures back where the
 *   member has not set new ones; a vehicle gets its visibility back while the owner kept it private (the moderation hold ends with the
 *   reversal, ModerationHolds); a build update shows again; a removed mod or message comes back with its photos.
 *
 * Runs inside DecideCase's transaction; the closures draw files after the commit.
 */
class ContentRestoration
{
    public function __construct(
        private readonly MediaService $media,
        private readonly VehicleSearchProjector $search,
        private readonly OgImages $og,
        private readonly SitemapWriter $sitemap,
    ) {}

    /**
     * Taken before ContentRemoval runs.
     *
     * @return array<string, mixed>|null
     */
    public function snapshot(ModerationCase $case): ?array
    {
        $id = $case->target_id;

        return match ($case->target_type) {
            ReportTargetType::Photo => ($photo = Media::query()->find($id)) instanceof Media ? $this->photoSnapshot($photo) : null,
            ReportTargetType::Member => ($member = User::query()->find($id)) instanceof User ? [
                'display_name' => $member->getAttribute('display_name'),
                'bio' => $member->getAttribute('bio'),
                'avatar_media_id' => $member->getAttribute('avatar_media_id'),
                'cover_media_id' => $member->getAttribute('cover_media_id'),
            ] : null,
            ReportTargetType::Vehicle => ($vehicle = Vehicle::query()->find($id)) instanceof Vehicle ? ['visibility' => $vehicle->getRawOriginal('visibility')] : null,
            ReportTargetType::BuildUpdate => ($update = BuildUpdate::query()->find($id)) instanceof BuildUpdate ? ['hidden' => (bool) $update->getAttribute('hidden')] : null,
            ReportTargetType::Modification, ReportTargetType::Message => [],
            ReportTargetType::Comment => ($comment = Comment::withTrashed()->find($id)) instanceof Comment ? ['status' => $comment->status->value] : null,
            ReportTargetType::Event => ($event = Event::query()->find($id)) instanceof Event ? ['status' => $event->status->value, 'removed' => $event->getAttribute('removed_at') !== null] : null,
        };
    }

    /**
     * @return array{lifted: list<string>, after: list<Closure(): void>}
     *
     * @throws DomainException when the decision has nothing to reverse
     */
    public function reverse(Decision $original, ?User $subject): array
    {
        return match ($original->action) {
            DecisionAction::Restrict, DecisionAction::Suspend => $this->lift($original, $subject),
            DecisionAction::RemoveContent => ['lifted' => ['content'], 'after' => $this->bringBack($original)],
            default => throw new DomainException('This decision restricted nothing that could be reversed.'),
        };
    }

    /**
     * @return array{lifted: list<string>, after: list<Closure(): void>}
     */
    private function lift(Decision $original, ?User $subject): array
    {
        $type = $original->restrictionType();

        if ($subject === null || $subject->trashed() || $type === null) {
            return ['lifted' => [], 'after' => []];
        }

        $restrictions = is_array($subject->restrictions) ? $subject->restrictions : [];
        $current = $restrictions[$type->value] ?? null;
        $holder = is_array($current) ? ($current['decision_id'] ?? null) : null;

        // Held for this decision, or for none named (rows written before decision ids): it goes. A later decision keeps its own.
        if (! is_array($current) || ($holder !== null && $holder !== $original->id)) {
            return ['lifted' => [], 'after' => []];
        }

        unset($restrictions[$type->value]);
        $changes = ['restrictions' => $restrictions === [] ? null : $restrictions];

        if ($type === DecisionRestriction::Suspension && $subject->status === UserStatus::Suspended) {
            $changes['status'] = UserStatus::Active;
        }

        $subject->forceFill($changes)->save();

        // A member who is public again belongs in the sitemap again; the share images are drawn on the next page view.
        return ['lifted' => [$type->value], 'after' => $type === DecisionRestriction::Suspension ? [fn () => $this->sitemap->forget()] : []];
    }

    /**
     * @return list<Closure(): void>
     */
    private function bringBack(Decision $original): array
    {
        $case = $original->case ?? ModerationCase::query()->find($original->case_id);

        if (! $case instanceof ModerationCase) {
            return [];
        }

        $snapshot = is_array($original->restore) ? $original->restore : [];
        $id = $case->target_id;

        return match ($case->target_type) {
            ReportTargetType::Photo => ($photo = Media::query()->find($id)) instanceof Media ? $this->photo($photo, $snapshot) : [],
            ReportTargetType::Member => ($member = User::query()->find($id)) instanceof User ? $this->member($member, $snapshot) : [],
            ReportTargetType::Vehicle => ($vehicle = Vehicle::query()->find($id)) instanceof Vehicle ? $this->vehicle($vehicle, $snapshot) : [],
            ReportTargetType::BuildUpdate => ($update = BuildUpdate::query()->find($id)) instanceof BuildUpdate ? $this->buildUpdate($update, $snapshot) : [],
            ReportTargetType::Modification => ($mod = Modification::withTrashed()->find($id)) instanceof Modification ? $this->modification($mod) : [],
            ReportTargetType::Message => ($message = Message::withTrashed()->find($id)) instanceof Message ? $this->message($message) : [],
            ReportTargetType::Comment => ($comment = Comment::withTrashed()->find($id)) instanceof Comment ? $this->comment($comment, $snapshot) : [],
            ReportTargetType::Event => ($event = Event::query()->find($id)) instanceof Event ? $this->event($event, $snapshot) : [],
        };
    }

    /**
     * @return array<string, mixed>
     */
    private function photoSnapshot(Media $photo): array
    {
        $parent = $photo->mediable;

        return [
            'moderation_status' => $photo->moderation_status->value,
            'vehicle_cover' => $parent instanceof Vehicle && $parent->getAttribute('cover_media_id') === $photo->id ? $parent->id : null,
            'avatar_of' => User::query()->where('avatar_media_id', $photo->id)->pluck('id')->all(),
            'cover_of' => User::query()->where('cover_media_id', $photo->id)->pluck('id')->all(),
        ];
    }

    /**
     * @param  array<string, mixed>  $snapshot
     * @return list<Closure(): void>
     */
    private function photo(Media $photo, array $snapshot): array
    {
        $before = ModerationStatus::tryFrom(is_string($snapshot['moderation_status'] ?? null) ? $snapshot['moderation_status'] : '');
        $photo->forceFill(['moderation_status' => $before === null || $before === ModerationStatus::Rejected ? ModerationStatus::Approved : $before])->save();

        $parent = $photo->mediable;
        $coverOf = $snapshot['vehicle_cover'] ?? null;

        if ($parent instanceof Vehicle && $coverOf === $parent->id && $parent->getAttribute('cover_media_id') === null) {
            $parent->forceFill(['cover_media_id' => $photo->id])->saveQuietly();
        }

        foreach (['avatar_of' => 'avatar_media_id', 'cover_of' => 'cover_media_id'] as $key => $column) {
            $ids = is_array($snapshot[$key] ?? null) ? $snapshot[$key] : [];

            if ($ids !== []) {
                User::query()->whereIn('id', $ids)->whereNull($column)->update([$column => $photo->id]);
            }
        }

        $vehicle = match (true) {
            $parent instanceof Vehicle => $parent,
            $parent instanceof Modification => $parent->vehicle,
            default => null,
        };

        if ($vehicle instanceof Vehicle) {
            $this->search->queue($vehicle);
        }

        return [function () use ($photo, $vehicle, $parent): void {
            $this->media->republish($photo);
            $subject = $vehicle ?? ($parent instanceof User ? $parent : null);

            if ($subject !== null) {
                $this->og->purge($subject);
                $this->og->queue($subject);
            }
        }];
    }

    /**
     * @param  array<string, mixed>  $snapshot
     * @return list<Closure(): void>
     */
    private function member(User $member, array $snapshot): array
    {
        $after = [];
        $changes = [];

        foreach (['display_name', 'bio'] as $field) {
            if ($member->getAttribute($field) === null && is_string($snapshot[$field] ?? null)) {
                $changes[$field] = $snapshot[$field];
            }
        }

        foreach (['avatar_media_id', 'cover_media_id'] as $field) {
            $photo = is_string($snapshot[$field] ?? null) ? Media::query()->find($snapshot[$field]) : null;

            if ($photo instanceof Media) {
                $after = [...$after, ...$this->photo($photo, ['moderation_status' => ModerationStatus::Approved->value])];

                if ($member->getAttribute($field) === null) {
                    $changes[$field] = $photo->id;
                }
            }
        }

        if ($changes !== []) {
            $member->forceFill($changes)->save();
        }

        return [...$after, function () use ($member): void {
            $this->og->purge($member);
            $this->og->queue($member);
        }];
    }

    /**
     * @param  array<string, mixed>  $snapshot
     * @return list<Closure(): void>
     */
    private function vehicle(Vehicle $vehicle, array $snapshot): array
    {
        $before = Visibility::tryFrom(is_string($snapshot['visibility'] ?? null) ? $snapshot['visibility'] : '');

        // Only while the owner left it private: a choice they made since stays theirs.
        if ($before !== null && $before !== Visibility::Private && $vehicle->getRawOriginal('visibility') === Visibility::Private->value) {
            Vehicle::query()->whereKey($vehicle->id)->toBase()->update(['visibility' => $before->value]);
        }

        $this->search->rebuild($vehicle->id);

        return [function () use ($vehicle): void {
            $this->og->purge($vehicle);
            $this->sitemap->forget();
        }];
    }

    /**
     * @param  array<string, mixed>  $snapshot
     * @return list<Closure(): void>
     */
    private function buildUpdate(BuildUpdate $update, array $snapshot): array
    {
        if (($snapshot['hidden'] ?? false) !== true) {
            $update->forceFill(['hidden' => false])->save();
        }

        return [];
    }

    /**
     * M4.12: an event removed by the decision gets its status back (unless it was already removed before it).
     *
     * @param  array<string, mixed>  $snapshot
     * @return list<Closure(): void>
     */
    private function event(Event $event, array $snapshot): array
    {
        $before = EventStatus::tryFrom((string) $event->getAttribute('status_before_removal'));

        if (($snapshot['removed'] ?? false) !== true && $event->getAttribute('removed_at') !== null && $before !== null) {
            $event->forceFill(['status' => $before, 'removed_at' => null, 'status_before_removal' => null])->save();
        }

        return [];
    }

    /**
     * @param  array<string, mixed>  $snapshot
     * @return list<Closure(): void>
     */
    private function comment(Comment $comment, array $snapshot): array
    {
        if (($snapshot['status'] ?? CommentStatus::Visible->value) !== CommentStatus::Removed->value) {
            $comment->forceFill(['status' => CommentStatus::Visible])->save();
        }

        return [];
    }

    /**
     * @return list<Closure(): void>
     */
    private function modification(Modification $mod): array
    {
        if ($mod->trashed()) {
            $mod->restoreQuietly();
        }

        $after = [];

        foreach ($mod->media()->get() as $photo) {
            $after = [...$after, ...$this->photo($photo, ['moderation_status' => ModerationStatus::Approved->value])];
        }

        $this->search->queue($mod->vehicle);

        return $after;
    }

    /**
     * @return list<Closure(): void>
     */
    private function message(Message $message): array
    {
        if ($message->trashed()) {
            $message->restoreQuietly();
        }

        $photo = $message->media_id === null ? null : Media::query()->find($message->media_id);

        if (! $photo instanceof Media) {
            return [];
        }

        $photo->forceFill(['moderation_status' => ModerationStatus::Approved])->save();

        return [function () use ($photo): void {
            $this->media->republish($photo);
        }];
    }
}
