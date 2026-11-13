<?php

namespace App\Actions\Social\Collections;

use App\Enums\ErrorCode;
use App\Exceptions\ApiException;
use App\Models\MemberCollection;
use App\Models\User;
use App\Services\Social\Collections;
use Illuminate\Support\Facades\DB;

/**
 * "Neue Sammlung" (COL-01, save sheet). Private; at most speedclub.social_2.max_collections (409 limit_reached). The default "Gespeichert"
 * exists first, so it stays the first tile.
 */
class CreateCollection
{
    public function __construct(private readonly Collections $collections) {}

    public function handle(User $user, string $name): MemberCollection
    {
        $this->collections->defaultFor($user);

        return DB::transaction(function () use ($user, $name): MemberCollection {
            User::query()->whereKey($user->id)->lockForUpdate()->value('id');
            $count = MemberCollection::query()->where('user_id', $user->id)->count();

            if ($count >= config()->integer('speedclub.social_2.max_collections')) {
                throw new ApiException(ErrorCode::LimitReached);
            }

            $collection = new MemberCollection([
                'name' => $name,
                'position' => (int) MemberCollection::query()->where('user_id', $user->id)->max('position') + 1,
            ]);
            $collection->forceFill(['user_id' => $user->id, 'is_default' => false])->save();

            return $collection;
        });
    }
}
