<?php

namespace App\Services\Businesses;

use App\Models\Business;
use App\Models\BusinessViewDay;
use App\Models\User;
use Carbon\CarbonImmutable;
use Illuminate\Support\Facades\DB;

/**
 * BIZ-03 "Profilaufrufe 30 Tage" (09 §7.11), private to the business team: one number per business and day, counted with the
 * page view; the team's own views and samples are not counted. No viewer, address or cookie is stored.
 */
final class BusinessViews
{
    public function record(Business $business, ?User $viewer): void
    {
        if ($business->is_sample || ! $business->isPublic() || ($viewer !== null && $business->roleOf($viewer) !== null)) {
            return;
        }

        $day = CarbonImmutable::now(config()->string('speedclub.display_timezone'))->toDateString();

        // One upsert on a unique key: cheap enough to run in the request (no queue worker on shared hosting).
        BusinessViewDay::query()->upsert([['business_id' => $business->id, 'day' => $day, 'views' => 1]], ['business_id', 'day'], ['views' => DB::raw('views + 1')]);
    }

    public function lastDays(Business $business, ?int $days = null): int
    {
        $days ??= config()->integer('speedclub.businesses.views_days');
        $from = CarbonImmutable::now(config()->string('speedclub.display_timezone'))->subDays($days - 1)->toDateString();

        return (int) BusinessViewDay::query()->where('business_id', $business->id)->where('day', '>=', $from)->sum('views');
    }
}
