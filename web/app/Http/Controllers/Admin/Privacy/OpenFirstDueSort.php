<?php

namespace App\Http\Controllers\Admin\Privacy;

use App\Enums\PrivacyRequestStatus;
use App\Models\PrivacyRequest;
use Illuminate\Database\Eloquent\Builder;
use Spatie\QueryBuilder\Sorts\Sort;

/**
 * ADM-45's due-date sort (DQ-636): open, in-progress and waiting requests first, by due date; completed and rejected ones below them, also
 * by due date. The direction applies to the dates, never to the grouping.
 *
 * @implements Sort<PrivacyRequest>
 */
final class OpenFirstDueSort implements Sort
{
    /**
     * @param  Builder<PrivacyRequest>  $query
     */
    public function __invoke(Builder $query, bool $descending, string $property): void
    {
        $final = [PrivacyRequestStatus::Completed->value, PrivacyRequestStatus::Rejected->value];

        $query->orderByRaw('case when status in (?, ?) then 1 else 0 end', $final)->orderBy('due_at', $descending ? 'desc' : 'asc');
    }
}
