<?php

namespace App\Actions\Social\Collections;

use App\Models\MemberCollection;

class RenameCollection
{
    public function handle(MemberCollection $collection, string $name): MemberCollection
    {
        $collection->fill(['name' => $name])->save();

        return $collection;
    }
}
