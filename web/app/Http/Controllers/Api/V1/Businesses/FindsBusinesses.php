<?php

namespace App\Http\Controllers\Api\V1\Businesses;

use App\Enums\ErrorCode;
use App\Exceptions\ApiException;
use App\Models\Business;
use App\Models\BusinessMember;
use App\Models\User;
use Illuminate\Support\Facades\Gate;

/**
 * Businesses are found by slug; one the reader may not see answers like a missing one: 404 business_unavailable (BusinessPolicy::view).
 * "My business" is the one the member owns or works for (one per member); none is 404 business_unavailable too.
 */
trait FindsBusinesses
{
    protected function findBusiness(string $slug, ?User $viewer): Business
    {
        $business = Business::query()->with(['owner', 'logo', 'cover'])->where('slug', mb_strtolower($slug))->first();

        if (! $business instanceof Business || ! Gate::forUser($viewer)->allows('view', $business)) {
            throw new ApiException(ErrorCode::BusinessUnavailable);
        }

        return $business;
    }

    protected function myBusiness(User $user, string $ability = 'update'): Business
    {
        $id = BusinessMember::query()->where('user_id', $user->id)->value('business_id');
        $business = is_string($id) ? Business::query()->with(['owner', 'logo', 'cover'])->find($id) : null;

        if (! $business instanceof Business || ! Gate::forUser($user)->allows('view', $business)) {
            throw new ApiException(ErrorCode::BusinessUnavailable);
        }

        Gate::forUser($user)->authorize($ability, $business);

        return $business;
    }
}
