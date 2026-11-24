<?php

namespace App\Services\Media;

use App\Enums\MediaStatus;
use App\Enums\ModerationStatus;
use App\Enums\PlateBlurState;
use App\Models\BuildUpdate;
use App\Models\Media;
use App\Models\Modification;
use App\Models\User;
use App\Models\Vehicle;
use Illuminate\Database\Eloquent\Builder;
use Illuminate\Database\Eloquent\Relations\MorphTo;

/**
 * M5.9a "Kennzeichen prüfen" (m5.9a-contract §4): the member's own finished photos from before the plate switch, one decision each.
 * Photos of vehicles, modifications and build updates, and the profile cover; never chat photos (private), avatars, event or business
 * covers. Nothing here changes a photo: the member decides ("Unkenntlich machen" through GAR-08, or "Kein Kennzeichen sichtbar").
 */
final class PlateCheck
{
    public const PAGE_SIZE = 25;

    public const MAX_PAGE_SIZE = 50;

    /**
     * @return Builder<Media>
     */
    public function pending(User $member): Builder
    {
        return $this->checkable($member)->where('plate_blur', PlateBlurState::Unchecked);
    }

    /**
     * The member's finished photos of the kinds the check covers, whatever their state.
     *
     * @return Builder<Media>
     */
    private function checkable(User $member): Builder
    {
        $cover = $member->getAttribute('cover_media_id');

        return Media::query()
            ->where('owner_id', $member->id)
            ->where('status', MediaStatus::Ready)
            ->where('moderation_status', '!=', ModerationStatus::Rejected)
            ->where(function (Builder $query) use ($cover, $member): void {
                // whereHasMorph: a photo of a deleted vehicle, mod or update is not listed (their soft-delete scopes apply).
                $query->whereHasMorph('mediable', [Vehicle::class, Modification::class, BuildUpdate::class])
                    ->orWhere(fn (Builder $profile) => $profile->where('mediable_type', (new User)->getMorphClass())
                        ->where('mediable_id', $member->id)
                        ->whereKey(is_string($cover) ? $cover : ''));
            });
    }

    /**
     * The same rows, with what an item shows loaded for the whole page.
     *
     * @return Builder<Media>
     */
    public function listing(User $member): Builder
    {
        $vehicle = ['make', 'vehicleModel', 'generation'];

        return $this->pending($member)
            ->with(['mediable' => fn (MorphTo $morph) => $morph->morphWith([
                Vehicle::class => $vehicle,
                Modification::class => array_map(fn (string $relation): string => 'vehicle.'.$relation, $vehicle),
                BuildUpdate::class => array_map(fn (string $relation): string => 'vehicle.'.$relation, $vehicle),
            ])])
            ->orderByDesc('id');
    }

    /**
     * One of the member's photos the check covers, decided or not, or null (another member's, a chat photo or avatar, not finished,
     * deleted): the endpoint answers 404. A decided one is found, so a repeated "keep" is a 204 that changes nothing.
     */
    public function find(User $member, string $mediaId): ?Media
    {
        return $this->checkable($member)->whereKey($mediaId)->first();
    }

    /**
     * @return 'vehicle'|'modification'|'build_update'|'cover'
     */
    public static function kind(Media $media): string
    {
        return match (true) {
            $media->mediable instanceof Vehicle => 'vehicle',
            $media->mediable instanceof Modification => 'modification',
            $media->mediable instanceof BuildUpdate => 'build_update',
            default => 'cover',
        };
    }

    public static function vehicle(Media $media): ?Vehicle
    {
        $parent = $media->mediable;

        return match (true) {
            $parent instanceof Vehicle => $parent,
            $parent instanceof Modification, $parent instanceof BuildUpdate => $parent->vehicle,
            default => null,
        };
    }
}
