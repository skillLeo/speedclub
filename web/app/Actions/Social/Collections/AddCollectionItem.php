<?php

namespace App\Actions\Social\Collections;

use App\Enums\CollectionItemType;
use App\Enums\ErrorCode;
use App\Exceptions\ApiException;
use App\Models\MemberCollection;
use App\Models\MemberCollectionItem;
use App\Models\User;
use App\Models\Vehicle;
use App\Services\Social\Collections;

/**
 * Saves a build, mod or build update into a collection (save sheet, 09 §8.6). Only what the member can see now (else the 404 of an
 * unknown item); an own build is 403. At most speedclub.social_2.max_collection_items per
 * collection (409 limit_reached). Idempotent: an item already there stays where it is.
 */
class AddCollectionItem
{
    public function __construct(private readonly Collections $collections) {}

    public function handle(User $user, MemberCollection $collection, CollectionItemType $type, string $id): MemberCollectionItem
    {
        $target = $this->collections->find($type, $id);

        if ($target === null || ! $this->collections->visible($user, $target)) {
            throw new ApiException(ErrorCode::NotFound, (string) __('social.collections.item_unavailable'));
        }

        // An own build is in the garage already, and saving it would count in the owner's own weekly aggregate (as SavePolicy).
        if ($target instanceof Vehicle && $target->isOwnedBy($user)) {
            throw new ApiException(ErrorCode::Forbidden);
        }

        $existing = $collection->items()->where('item_type', $type)->where('item_id', (string) $target->getKey())->first();

        if ($existing === null && $collection->items()->count() >= config()->integer('speedclub.social_2.max_collection_items')) {
            throw new ApiException(ErrorCode::LimitReached);
        }

        return $existing ?? $this->collections->add($collection, $type, (string) $target->getKey());
    }
}
