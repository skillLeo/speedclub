<?php

namespace App\Actions\Social\Collections;

use App\Enums\ErrorCode;
use App\Exceptions\ApiException;
use App\Models\MemberCollection;
use App\Models\User;
use Illuminate\Support\Facades\DB;

/**
 * COL-01 reorder: $ids top first, every collection of the member exactly once (else 422 on ids).
 */
class ReorderCollections
{
    /**
     * @param  list<string>  $ids
     */
    public function handle(User $user, array $ids): void
    {
        DB::transaction(function () use ($user, $ids): void {
            User::query()->whereKey($user->id)->lockForUpdate()->value('id');
            $ids = array_map(strtolower(...), $ids);
            $stored = MemberCollection::query()->where('user_id', $user->id)->pluck('id')->map(strval(...))->all();

            if (count($ids) !== count($stored) || array_diff($stored, $ids) !== []) {
                throw new ApiException(ErrorCode::ValidationFailed, errors: ['ids' => [(string) __('social.collections.order_mismatch')]]);
            }

            foreach ($ids as $position => $id) {
                MemberCollection::query()->whereKey($id)->update(['position' => $position]);
            }
        });
    }
}
