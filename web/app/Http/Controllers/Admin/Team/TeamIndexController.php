<?php

namespace App\Http\Controllers\Admin\Team;

use App\Enums\StaffStatus;
use App\Http\Controllers\Admin\Support\TableProps;
use App\Http\Controllers\Controller;
use App\Models\Staff;
use App\Services\Team\OwnerRules;
use Illuminate\Database\Eloquent\Builder;
use Illuminate\Http\Request;
use Inertia\Inertia;
use Inertia\Response;
use Spatie\QueryBuilder\AllowedFilter;
use Spatie\QueryBuilder\QueryBuilder;

/**
 * ADM-39 staff list (06 §3 Team & roles, m3.6 §1): name, address, roles, state (aktiv · eingeladen · gesperrt · deaktiviert · gelöscht),
 * second factor, last sign-in; the invite drawer (roles with their four-eyes hint) for staff.invite holders. Deleted accounts only with
 * the filter `state=deleted` (their rows stay for the audit log).
 */
class TeamIndexController extends Controller
{
    public const TABLE = 'team-staff';

    public const DEFAULT_SORT = 'name';

    public function __invoke(Request $request): Response
    {
        /** @var Staff $viewer */
        $viewer = $request->user('staff');

        return Inertia::render('Team/Index', [
            ...TableProps::make(self::query($request), $request, self::TABLE, $viewer, fn (array $staff): array => StaffPresenter::rows($staff, $viewer), self::DEFAULT_SORT),
            'roles' => fn (): array => StaffPresenter::roleOptions(),
            'owners' => fn (): array => [
                'active' => Staff::query()->role('owner', 'staff')->where('status', StaffStatus::Active->value)->where('password_proof_required', false)->whereNull('anonymised_at')->count(),
                'max' => OwnerRules::maxOwners(),
            ],
            'viewerIsOwner' => $viewer->isOwner(),
        ]);
    }

    /**
     * @return QueryBuilder<Staff>
     */
    public static function query(Request $request): QueryBuilder
    {
        $state = $request->input('filter.state');

        $query = QueryBuilder::for(Staff::query()->with('roles:id,name'), $request)
            ->allowedFilters(
                AllowedFilter::callback('state', fn (Builder $q, mixed $value) => match ($value) {
                    'active' => $q->where('status', StaffStatus::Active->value)->where('password_proof_required', false)->whereNull('anonymised_at'),
                    'invited' => $q->where('status', StaffStatus::Active->value)->where('password_proof_required', true)->whereNull('anonymised_at'),
                    'suspended' => $q->where('status', StaffStatus::Suspended->value)->whereNull('anonymised_at'),
                    'deactivated' => $q->where('status', StaffStatus::Deactivated->value)->whereNull('anonymised_at'),
                    'deleted' => $q->whereNotNull('anonymised_at'),
                    default => $q->whereRaw('1 = 0'),
                })->delimiter("\u{1}"),
                AllowedFilter::callback('role', fn (Builder $q, mixed $value) => $q->whereHas('roles', fn (Builder $r) => $r->where('name', is_string($value) ? $value : '-')))->delimiter("\u{1}"),
                AllowedFilter::callback('q', function (Builder $q, mixed $value): void {
                    $text = trim(mb_substr(is_string($value) ? $value : '', 0, 120));
                    $like = '%'.str_replace(['!', '%', '_'], ['!!', '!%', '!_'], $text).'%';
                    $q->where(fn (Builder $w) => $w->whereRaw("name like ? escape '!'", [$like])->orWhereRaw("email like ? escape '!'", [$like]));
                })->delimiter("\u{1}"),
            )
            ->allowedSorts('name', 'last_login_at', 'created_at')
            ->defaultSort(self::DEFAULT_SORT);

        if ($state !== 'deleted') {
            $query->getEloquentBuilder()->whereNull('anonymised_at');
        }

        $query->getEloquentBuilder()->orderBy('id');

        return $query;
    }
}
