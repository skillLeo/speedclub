<?php

namespace App\Actions\Social\Collections;

use App\Enums\CollectionItemType;
use App\Models\MemberCollection;
use App\Services\Social\Collections;

/**
 * By reference alone: also something that went private or was deleted can leave the collection.
 */
class RemoveCollectionItem
{
    public function __construct(private readonly Collections $collections) {}

    public function handle(MemberCollection $collection, CollectionItemType $type, string $id): void
    {
        $this->collections->remove($collection, $type, strtolower($id));
    }
}
