<?php

namespace App\Actions\Wrapped;

use App\Enums\ErrorCode;
use App\Exceptions\ApiException;
use App\Models\User;
use App\Models\Wrapped;
use App\Services\Wrapped\WrappedReleases;
use Illuminate\Support\Facades\Gate;

/**
 * The member's Wrapped of a season for the API (m5.9e contract §5), with the release gate: 403 `wrapped_not_released` while the season
 * is not out (the staff preview token and the staging demo of a sample member open it early, WrappedReleases), then 404 `not_found`
 * when the member has none. Samples are never read in production. The policy is the last word: a Wrapped is its member's alone.
 */
final class FindMyWrapped
{
    public function __construct(private readonly WrappedReleases $releases) {}

    public function __invoke(User $member, string $seasonKey): Wrapped
    {
        $wrapped = Wrapped::query()
            ->where('user_id', $member->id)
            ->where('season_key', $seasonKey)
            ->when(app()->isProduction(), fn ($query) => $query->where('is_sample', false))
            ->with('user.avatar')
            ->first();

        if ($wrapped instanceof Wrapped ? ! $this->releases->opens($wrapped) : ! $this->releases->isReleased($seasonKey)) {
            throw new ApiException(ErrorCode::WrappedNotReleased);
        }

        if (! $wrapped instanceof Wrapped) {
            throw new ApiException(ErrorCode::NotFound);
        }

        Gate::forUser($member)->authorize('view', $wrapped);

        return $wrapped;
    }
}
