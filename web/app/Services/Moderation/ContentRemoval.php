<?php

namespace App\Services\Moderation;

use App\Enums\ModerationStatus;
use App\Enums\ReportTargetType;
use App\Enums\Visibility;
use App\Models\BuildUpdate;
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

/**
 * remove_content (m2.6-contract §2): the target stops being shown to anybody but its owner, in a way the owner cannot undo, and stays
 * restorable for an appeal. Each type uses the hiding every read path already honours:
 *
 * - photo: moderation_status rejected (MediaPolicy, usablePhoto) and its public files withdrawn at once (ADR-123); the private original
 *   stays for the appeal. A cover moves to the next usable photo, an avatar or profile cover is cleared;
 * - member: display name and bio cleared, avatar and profile cover handled like a photo;
 * - vehicle: set to private, and ModerationHolds keeps the owner from making it public or unlisted again;
 * - build update: hidden, and ModerationHolds keeps the owner from showing it again;
 * - modification: soft-deleted with its photos, without a new Verlauf entry (a "removed" entry would repeat what was removed);
 * - message: soft-deleted (withdrawn for both sides), its photo with it.
 *
 * A moderation removal is no news of the build: search is rebuilt without touching the build's dates, so it does not climb Für dich or
 * Neue Builds. remove() runs inside DecideCase's transaction; the closures it returns delete files and pictures after the commit.
 */
class ContentRemoval
{
    public function __construct(
        private readonly MediaService $media,
        private readonly VehicleSearchProjector $search,
        private readonly OgImages $og,
        private readonly SitemapWriter $sitemap,
    ) {}

    /**
     * @return list<Closure(): void> work for after the commit
     */
    public function remove(ModerationCase $case): array
    {
        $id = $case->target_id;

        return match ($case->target_type) {
            ReportTargetType::Photo => ($photo = Media::query()->find($id)) instanceof Media ? $this->photo($photo) : [],
            ReportTargetType::Member => ($member = User::query()->find($id)) instanceof User ? $this->member($member) : [],
            ReportTargetType::Vehicle => ($vehicle = Vehicle::query()->find($id)) instanceof Vehicle ? $this->vehicle($vehicle) : [],
            ReportTargetType::BuildUpdate => ($update = BuildUpdate::query()->find($id)) instanceof BuildUpdate ? $this->buildUpdate($update) : [],
            ReportTargetType::Modification => ($mod = Modification::query()->find($id)) instanceof Modification ? $this->modification($mod) : [],
            ReportTargetType::Message => ($message = Message::query()->find($id)) instanceof Message ? $this->message($message) : [],
        };
    }

    /**
     * @return list<Closure(): void>
     */
    private function photo(Media $photo): array
    {
        $photo->forceFill(['moderation_status' => ModerationStatus::Rejected])->save();
        $parent = $photo->mediable;

        if ($parent instanceof Vehicle && $parent->getAttribute('cover_media_id') === $photo->id) {
            $parent->forceFill(['cover_media_id' => $parent->media()->usablePhoto()->orderBy('sort')->orderBy('id')->value('id')])->saveQuietly();
        }

        User::query()->where('avatar_media_id', $photo->id)->update(['avatar_media_id' => null]);
        User::query()->where('cover_media_id', $photo->id)->update(['cover_media_id' => null]);

        $vehicle = match (true) {
            $parent instanceof Vehicle => $parent,
            $parent instanceof Modification => $parent->vehicle,
            default => null,
        };

        if ($vehicle instanceof Vehicle) {
            $this->search->queue($vehicle);
        }

        return [function () use ($photo, $parent, $vehicle): void {
            $this->media->withdraw($photo);
            $subject = $vehicle ?? ($parent instanceof User ? $parent : null);

            if ($subject !== null) {
                $this->og->purge($subject);
                $this->og->queue($subject);
            }
        }];
    }

    /**
     * @return list<Closure(): void>
     */
    private function member(User $member): array
    {
        $after = [];

        foreach (array_filter([$member->getAttribute('avatar_media_id'), $member->getAttribute('cover_media_id')]) as $mediaId) {
            $photo = Media::query()->find($mediaId);

            if ($photo instanceof Media) {
                $after = [...$after, ...$this->photo($photo)];
            }
        }

        $member->forceFill(['display_name' => null, 'bio' => null, 'avatar_media_id' => null, 'cover_media_id' => null])->save();

        return [...$after, function () use ($member): void {
            $this->og->purge($member);
            $this->og->queue($member);
        }];
    }

    /**
     * @return list<Closure(): void>
     */
    private function vehicle(Vehicle $vehicle): array
    {
        Vehicle::query()->whereKey($vehicle->id)->toBase()->update(['visibility' => Visibility::Private->value]);
        $this->search->rebuild($vehicle->id);

        return [function () use ($vehicle): void {
            $this->og->purge($vehicle);
            $this->sitemap->forget();
        }];
    }

    /**
     * @return list<Closure(): void>
     */
    private function buildUpdate(BuildUpdate $update): array
    {
        $update->forceFill(['hidden' => true, 'open_until' => null])->save();

        return [];
    }

    /**
     * @return list<Closure(): void>
     */
    private function modification(Modification $mod): array
    {
        $photos = $mod->media()->get();
        $vehicle = $mod->vehicle;
        $mod->delete();
        $after = [];

        foreach ($photos as $photo) {
            $after = [...$after, ...$this->photo($photo)];
        }

        $this->search->queue($vehicle);

        return $after;
    }

    /**
     * @return list<Closure(): void>
     */
    private function message(Message $message): array
    {
        $photo = $message->media_id === null ? null : Media::query()->find($message->media_id);
        $message->delete();

        if (! $photo instanceof Media) {
            return [];
        }

        $photo->forceFill(['moderation_status' => ModerationStatus::Rejected])->save();

        return [function () use ($photo): void {
            $this->media->withdraw($photo);
        }];
    }
}
