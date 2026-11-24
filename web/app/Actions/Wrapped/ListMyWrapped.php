<?php

namespace App\Actions\Wrapped;

use App\Models\User;
use App\Models\Wrapped;
use App\Services\Wrapped\Season;
use App\Services\Wrapped\WrappedReleases;
use Carbon\CarbonImmutable;
use Illuminate\Support\Collection;

/**
 * GET me/wrapped (m5.9e contract §5): the member's generated seasons, newest first (a year after its season), each with whether it is
 * open now, and the countdown of the soonest of them that opens within `wrapped.countdown_days` (flag `wrapped.countdown`).
 */
final class ListMyWrapped
{
    public function __construct(private readonly WrappedReleases $releases) {}

    /**
     * @return array{seasons: Collection<int, array{wrapped: Wrapped, released: bool}>, countdown: array{season_key: string, release_at: CarbonImmutable}|null}
     */
    public function __invoke(User $member): array
    {
        $rows = Wrapped::query()
            ->where('user_id', $member->id)
            ->when(app()->isProduction(), fn ($query) => $query->where('is_sample', false))
            ->get(['id', 'user_id', 'season_key', 'is_sample', 'generated_at', 'viewed_at'])
            ->filter(fn (Wrapped $wrapped): bool => Season::tryFrom($wrapped->season_key) !== null)
            ->sortByDesc(function (Wrapped $wrapped): int {
                $season = Season::from($wrapped->season_key);

                return $season->year * 2 + ($season->isYear() ? 1 : 0);
            })
            ->values();

        return [
            'seasons' => $rows->map(fn (Wrapped $wrapped): array => ['wrapped' => $wrapped, 'released' => $this->releases->opens($wrapped)]),
            'countdown' => $this->releases->countdown(array_values($rows->pluck('season_key')->all())),
        ];
    }
}
