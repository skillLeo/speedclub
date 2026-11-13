<?php

namespace App\Services\Social;

use App\Enums\CollectionItemType;
use App\Models\BuildUpdate;
use App\Models\Business;
use App\Models\Event;
use App\Models\Media;
use App\Models\MemberCollection;
use App\Models\MemberCollectionItem;
use App\Models\Modification;
use App\Models\Save;
use App\Models\User;
use App\Models\Vehicle;
use Illuminate\Database\Eloquent\Model;
use Illuminate\Support\Collection;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Gate;

/**
 * Member collections (09 §8.6, COL-01/02). The default "Gespeichert" replaces PROF-05's single list: a build in any of the member's
 * collections is a save (`saves` keeps feeding the owner's weekly aggregate, ADR-139), and saving a build with the old route puts it into
 * "Gespeichert". Lists show the highest position first, so what was added last leads.
 */
final class Collections
{
    public const FLAG = 'collections';

    private const COVER_CANDIDATES = 12;

    /**
     * The member's "Gespeichert", created on first use under the member's row lock, so two first saves at once make one.
     */
    public function defaultFor(User $user): MemberCollection
    {
        return DB::transaction(function () use ($user): MemberCollection {
            User::query()->whereKey($user->id)->lockForUpdate()->value('id');

            $existing = MemberCollection::query()->where('user_id', $user->id)->where('is_default', true)->first();

            if ($existing instanceof MemberCollection) {
                return $existing;
            }

            $collection = new MemberCollection(['name' => null, 'position' => 0]);
            $collection->forceFill(['user_id' => $user->id, 'is_default' => true])->save();

            return $collection;
        });
    }

    /**
     * The row behind an item reference, or null for anything that does not exist.
     */
    public function find(CollectionItemType $type, string $id): Vehicle|Modification|BuildUpdate|Event|Business|null
    {
        if (preg_match('/\A[0-9A-HJKMNP-TV-Za-hjkmnp-tv-z]{26}\z/', $id) !== 1) {
            return null;
        }

        $id = strtolower($id);

        return match ($type) {
            CollectionItemType::Vehicle => Vehicle::query()->find($id),
            CollectionItemType::Modification => Modification::query()->with('vehicle')->find($id),
            CollectionItemType::BuildUpdate => BuildUpdate::query()->with('vehicle')->find($id),
            CollectionItemType::Event => Event::query()->with('organiser')->find($id),
            // M4.14 (09 §8.6): a business profile.
            CollectionItemType::Business => Business::query()->with('owner')->find($id),
        };
    }

    /**
     * Whether $user may see the item now (the same rules as its own page).
     */
    public function visible(User $user, Model $item): bool
    {
        return Gate::forUser($user)->allows('view', $item);
    }

    /**
     * Adds an item to a collection, idempotently: it stays where it is when it is there already. A build becomes a save.
     */
    public function add(MemberCollection $collection, CollectionItemType $type, string $id): MemberCollectionItem
    {
        return DB::transaction(function () use ($collection, $type, $id): MemberCollectionItem {
            MemberCollection::query()->whereKey($collection->id)->lockForUpdate()->value('id');

            $existing = MemberCollectionItem::query()->where('collection_id', $collection->id)->where('item_type', $type)->where('item_id', $id)->first();

            if ($existing instanceof MemberCollectionItem) {
                return $existing;
            }

            $item = new MemberCollectionItem([
                'collection_id' => $collection->id,
                'item_type' => $type,
                'item_id' => $id,
                'position' => (int) $collection->items()->max('position') + 1,
            ]);
            $item->forceFill(['created_at' => now()])->save();
            $collection->touch();

            if ($type === CollectionItemType::Vehicle) {
                Save::query()->insertOrIgnore(['user_id' => $collection->user_id, 'vehicle_id' => $id, 'created_at' => now()]);
            }

            return $item;
        });
    }

    /**
     * Takes an item out of one collection; a build no longer in any of the member's collections is no longer saved.
     */
    public function remove(MemberCollection $collection, CollectionItemType $type, string $id): void
    {
        DB::transaction(function () use ($collection, $type, $id): void {
            $collection->items()->where('item_type', $type)->where('item_id', $id)->delete();
            $collection->touch();

            if ($type === CollectionItemType::Vehicle) {
                $this->forgetSaveIfUnused((string) $collection->user_id, $id);
            }
        });
    }

    /**
     * PROF-05's save route: the build goes into "Gespeichert".
     */
    public function saved(User $user, Vehicle $vehicle): void
    {
        $this->add($this->defaultFor($user), CollectionItemType::Vehicle, $vehicle->id);
    }

    /**
     * PROF-05's unsave route: the build leaves every collection of the member.
     */
    public function unsaved(User $user, string $vehicleId): void
    {
        MemberCollectionItem::query()
            ->whereIn('collection_id', MemberCollection::query()->select('id')->where('user_id', $user->id))
            ->where('item_type', CollectionItemType::Vehicle)
            ->where('item_id', $vehicleId)
            ->delete();
    }

    /**
     * Deleting a collection: its builds that are in no other collection of the member stop being saves.
     */
    public function deleted(MemberCollection $collection): void
    {
        DB::transaction(function () use ($collection): void {
            $vehicles = $collection->items()->where('item_type', CollectionItemType::Vehicle)->pluck('item_id')->map(strval(...))->all();
            $collection->delete();

            foreach ($vehicles as $vehicle) {
                $this->forgetSaveIfUnused((string) $collection->user_id, $vehicle);
            }
        });
    }

    /**
     * COL-01's mosaic: up to four photos of the newest items $user can still see (a build's cover, a post's first photo, a mod's build
     * cover), looking at the newest COVER_CANDIDATES items.
     *
     * @return Collection<int, Media>
     */
    public function covers(User $user, MemberCollection $collection): Collection
    {
        $photos = [];

        foreach ($collection->items()->orderByDesc('position')->limit(self::COVER_CANDIDATES)->get() as $item) {
            $target = $this->find($item->item_type, $item->item_id);

            if ($target === null || ! $this->visible($user, $target)) {
                continue;
            }

            $photo = match (true) {
                $target instanceof Vehicle => $target->cover,
                $target instanceof BuildUpdate => $target->photos()->usablePhoto()->first(),
                $target instanceof Event => $target->cover,
                // M4.14: a business's cover.
                $target instanceof Business => $target->cover,
                default => $target->vehicle->cover,
            };

            if ($photo instanceof Media && $photo->isUsablePhoto()) {
                $photos[] = $photo;
            }

            if (count($photos) === 4) {
                break;
            }
        }

        return collect($photos);
    }

    /**
     * Items gone with their row (a deleted build update, mod or vehicle), so no collection points nowhere.
     */
    public static function forgetItem(CollectionItemType $type, string $id): void
    {
        MemberCollectionItem::query()->where('item_type', $type)->where('item_id', $id)->delete();
    }

    private function forgetSaveIfUnused(string $userId, string $vehicleId): void
    {
        $still = MemberCollectionItem::query()
            ->whereIn('collection_id', MemberCollection::query()->select('id')->where('user_id', $userId))
            ->where('item_type', CollectionItemType::Vehicle)
            ->where('item_id', $vehicleId)
            ->exists();

        if (! $still) {
            Save::query()->where('user_id', $userId)->where('vehicle_id', $vehicleId)->delete();
        }
    }
}
