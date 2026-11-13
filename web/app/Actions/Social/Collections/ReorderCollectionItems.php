<?php

namespace App\Actions\Social\Collections;

use App\Enums\ErrorCode;
use App\Exceptions\ApiException;
use App\Models\MemberCollection;
use Illuminate\Support\Facades\DB;

/**
 * COL-02 reorder: entries as "type:id", top first, each at most once; an unknown entry is 422 on ids. Entries the list did not show (the
 * member cannot see them right now) follow in their previous order, so the app sends what it shows.
 */
class ReorderCollectionItems
{
    /**
     * @param  list<string>  $keys
     */
    public function handle(MemberCollection $collection, array $keys): void
    {
        DB::transaction(function () use ($collection, $keys): void {
            MemberCollection::query()->whereKey($collection->id)->lockForUpdate()->value('id');
            $stored = $collection->items()->get()->keyBy(fn ($item): string => $item->item_type->value.':'.$item->item_id);
            $keys = array_map(strtolower(...), $keys);

            if (array_diff($keys, $stored->keys()->all()) !== []) {
                throw new ApiException(ErrorCode::ValidationFailed, errors: ['ids' => [(string) __('social.collections.order_mismatch')]]);
            }

            $rest = $stored->except($keys)->sortByDesc(fn ($item): int => $item->position)->keys()->all();
            $order = [...$keys, ...$rest];
            $top = count($order);

            foreach ($order as $index => $key) {
                $stored->get($key)?->forceFill(['position' => $top - $index])->save();
            }

            $collection->touch();
        });
    }
}
