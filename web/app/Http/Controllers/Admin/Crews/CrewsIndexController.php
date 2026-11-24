<?php

namespace App\Http\Controllers\Admin\Crews;

use App\Http\Controllers\Admin\Support\TableProps;
use App\Http\Controllers\Controller;
use App\Models\Staff;
use App\Services\Crews\CrewAdminQuery;
use Illuminate\Database\Eloquent\Builder;
use Illuminate\Http\Request;
use Inertia\Inertia;
use Inertia\Response;
use Spatie\QueryBuilder\AllowedFilter;
use Spatie\QueryBuilder\QueryBuilder;

/**
 * ADM-80 Crews (R4-2.3, contract-crews.md §8): every crew, deleted ones included, from CrewAdminQuery. Whitelisted filters: `q` (name or
 * slug) and `status` (active · hidden · removed = deleted by staff · deleted = deleted by the founder); sorts: newest (default) and name.
 * Never sorted by size (C2).
 */
class CrewsIndexController extends Controller
{
    public const TABLE = 'crews';

    public const DEFAULT_SORT = '-created_at';

    public const STATES = ['active', 'hidden', 'removed', 'deleted', 'ended'];

    public function __invoke(Request $request, CrewAdminQuery $crews): Response
    {
        /** @var Staff $staff */
        $staff = $request->user('staff');
        $filters = TableProps::filters($request);
        $status = in_array($filters['status'] ?? null, self::STATES, true) ? $filters['status'] : null;

        // CrewAdminQuery filters by name/slug and the stored status; "active"/"hidden" leave out crews their founder deleted, "deleted" is
        // exactly those (soft-deleted, status not removed).
        $base = $crews->query([
            'q' => $filters['q'] ?? null,
            'status' => in_array($status, ['active', 'hidden', 'removed'], true) ? $status : null,
            ...(in_array($status, ['active', 'hidden'], true) ? ['deleted' => false] : []),
        ])->reorder();

        if ($status === 'deleted') {
            $base->whereNotNull('deleted_at')->where('status', '!=', 'removed')->whereNull('ended_reason');
        }

        // R4DQ-55: crews the system ended because nobody was left in them.
        if ($status === 'ended') {
            $base->whereNotNull('deleted_at')->where('status', '!=', 'removed')->whereNotNull('ended_reason');
        }

        $query = QueryBuilder::for($base, $request)
            ->allowedFilters(
                // Both are applied by CrewAdminQuery above; listed so the whitelist accepts them.
                AllowedFilter::callback('q', fn (Builder $q) => $q)->delimiter("\u{1}"),
                AllowedFilter::callback('status', fn (Builder $q) => $q)->delimiter("\u{1}"),
            )
            ->allowedSorts('created_at', 'name')
            ->defaultSort(self::DEFAULT_SORT);
        $query->getEloquentBuilder()->orderBy('crews.id');

        return Inertia::render('Crews/Index', [
            ...TableProps::make($query, $request, self::TABLE, $staff, fn (array $rows): array => CrewAdminRecord::rows($rows), self::DEFAULT_SORT),
        ]);
    }
}
