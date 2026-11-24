<?php

namespace App\Services\Crews;

use App\Enums\CrewStatus;
use App\Models\Crew;
use Illuminate\Database\Eloquent\Builder;

/**
 * The staff list of crews (ADM-80, for the admin builder): every crew, deleted ones included (`status=removed` or `deleted`), with
 * search by name or slug and a status filter. Order: newest first. Never a ranking by size.
 */
final class CrewAdminQuery
{
    /**
     * @param  array{q?: string|null, status?: string|null, deleted?: bool}  $filters
     * @return Builder<Crew>
     */
    public function query(array $filters = []): Builder
    {
        $query = Crew::withTrashed()->with(['logo', 'founderMembership.user']);
        $q = trim((string) ($filters['q'] ?? ''));

        if ($q !== '') {
            $like = '%'.addcslashes($q, '\\%_').'%';
            $query->where(fn (Builder $match) => $match->where('name', 'like', $like)->orWhere('slug', 'like', $like));
        }

        $status = CrewStatus::tryFrom((string) ($filters['status'] ?? ''));

        if ($status !== null) {
            $query->where('status', $status->value);
        }

        if (($filters['deleted'] ?? null) === false) {
            $query->whereNull('deleted_at');
        }

        return $query->orderByDesc('created_at')->orderByDesc('id');
    }
}
