<?php

use App\Models\User;
use App\Services\Dex\CityMatcher;
use Illuminate\Database\Migrations\Migration;
use Illuminate\Support\Facades\DB;

/**
 * CR-P5G-08 / SEC-P5G-04: users.bundesland shows publicly on Build Score rank lines, so it comes from the public profile city only,
 * never from the private SET-11 region. Recomputes every member's value with the new rule (CityMatcher::bundeslandFor), in chunks, by
 * query (no model events, no updated_at). Members without a public city lose their Bundesland and with it their Bundesland rank, which
 * the next Build Score night drops. Nothing to undo: down() leaves the values as they are.
 */
return new class extends Migration
{
    public function up(): void
    {
        $matcher = app(CityMatcher::class);

        User::withTrashed()
            ->where(fn ($query) => $query->whereNotNull('bundesland')->orWhereNotNull('city'))
            ->select(['id', 'city', 'bundesland'])
            ->chunkById(500, function ($users) use ($matcher): void {
                foreach ($users as $user) {
                    $derived = $matcher->bundeslandFor($user)?->value;
                    $current = $user->getRawOriginal('bundesland');

                    if ($derived !== $current) {
                        DB::table('users')->where('id', $user->id)->update(['bundesland' => $derived]);
                    }
                }
            });
    }

    public function down(): void {}
};
