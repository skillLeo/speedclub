<?php

namespace App\Http\Controllers\Admin\Businesses;

use App\Enums\BusinessStatus;
use App\Http\Controllers\Admin\Support\TableProps;
use App\Http\Controllers\Controller;
use App\Models\Business;
use App\Models\Staff;
use Illuminate\Database\Eloquent\Builder;
use Illuminate\Http\Request;
use Inertia\Inertia;
use Inertia\Response;
use Spatie\QueryBuilder\AllowedFilter;
use Spatie\QueryBuilder\QueryBuilder;

/**
 * ADM-55 Betriebs-Anträge (09 §10.3, the SplitQueue of §10.2 shared with reports and events): tabs Anträge (oldest first: the SLA
 * order) · Verifiziert · Abgelehnt · Gesperrt · Alle, filters q (name, legal name, city, @owner) and kind. `?business=<id>` opens that
 * business in the right pane (`selected`, the ADM-56 record); `decided` is the last decision of this session (the 5-s undo).
 */
class BusinessQueueController extends Controller
{
    public const TABS = ['applied', 'verified', 'rejected', 'suspended', 'all'];

    public const TABLE = 'businesses';

    /** Session flash of BusinessActionsController: the business just decided, for the undo. */
    public const DECIDED = 'businesses.decided';

    public function __invoke(Request $request): Response
    {
        /** @var Staff $staff */
        $staff = $request->user('staff');
        $tab = $request->query('tab');
        $tab = is_string($tab) && in_array($tab, self::TABS, true) ? $tab : 'applied';
        $status = BusinessStatus::tryFrom($tab);
        $defaultSort = $tab === 'applied' ? 'submitted_at' : '-submitted_at';

        $base = Business::query()->with('owner')->when($status !== null, fn (Builder $query) => $query->where('businesses.status', $status?->value));

        $query = QueryBuilder::for($base, $request)
            ->allowedFilters(
                AllowedFilter::callback('q', function (Builder $q, mixed $value): void {
                    $term = is_string($value) ? trim($value) : '';

                    if ($term === '') {
                        return;
                    }

                    $like = '%'.addcslashes(ltrim($term, '@'), '%_\\').'%';
                    $q->where(fn (Builder $any) => $any->where('businesses.name', 'like', $like)->orWhere('businesses.legal_name', 'like', $like)
                        ->orWhere('businesses.city', 'like', $like)
                        ->orWhereHas('owner', fn (Builder $owner) => $owner->where('username', 'like', $like)));
                }),
                AllowedFilter::callback('kind', fn (Builder $q, mixed $value) => $q->where('businesses.kind', is_string($value) ? $value : '-'))->delimiter("\u{1}"),
            )
            ->allowedSorts('submitted_at', 'created_at', 'name')
            ->defaultSort($defaultSort);

        return Inertia::render('Businesses/Queue', [
            ...TableProps::make($query, $request, self::TABLE.'-'.$tab, $staff, fn (array $businesses): array => BusinessAdminRecord::rows($businesses), $defaultSort),
            'tab' => $tab,
            'counts' => fn (): array => ['applied' => Business::query()->where('status', BusinessStatus::Applied->value)->count()],
            'canDecide' => $staff->can('moderation.decide'),
            'selected' => fn (): ?array => self::selected($request, $staff),
            'decided' => fn (): mixed => $request->session()->get(self::DECIDED),
        ]);
    }

    /**
     * @return array<string, mixed>|null
     */
    private static function selected(Request $request, Staff $staff): ?array
    {
        $id = $request->query('business');

        if (! is_string($id) || preg_match('/^[0-9A-Za-z]{26}$/', $id) !== 1) {
            return null;
        }

        $business = Business::query()->with('owner')->find(strtolower($id));

        return $business === null ? null : BusinessAdminRecord::detail($business, $staff);
    }
}
