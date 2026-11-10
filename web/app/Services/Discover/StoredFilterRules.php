<?php

namespace App\Services\Discover;

use App\Http\Requests\Api\V1\Discover\Concerns\ValidatesSearchFilters;
use Illuminate\Support\Facades\Validator;

/**
 * The DISC-02 parameter rules (ValidatesSearchFilters) for filters stored outside a request, such as a collection's (M2.3 review #10): a
 * row the admin or a hand-edited seed got wrong is skipped instead of reaching SearchFilterResolver with a value of the wrong type.
 */
final class StoredFilterRules
{
    use ValidatesSearchFilters;

    /**
     * @param  array<mixed>  $filters
     */
    public function passes(array $filters): bool
    {
        return ! Validator::make($filters, $this->filterRules())->fails();
    }
}
