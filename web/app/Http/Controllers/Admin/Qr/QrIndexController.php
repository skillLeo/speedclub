<?php

namespace App\Http\Controllers\Admin\Qr;

use App\Enums\QrStatus;
use App\Http\Controllers\Admin\Support\QaClock;
use App\Http\Controllers\Admin\Support\TableProps;
use App\Http\Controllers\Controller;
use App\Models\QrCode;
use App\Models\Staff;
use App\Services\Garage\VehiclePresenter;
use App\Services\Qr\QrCodes;
use Illuminate\Database\Eloquent\Builder;
use Illuminate\Http\Request;
use Inertia\Inertia;
use Inertia\Response;
use Spatie\QueryBuilder\AllowedFilter;
use Spatie\QueryBuilder\QueryBuilder;

/**
 * ADM-18 QR registry (06 §3 QR): code, status, vehicle, owner, created, scans of the last 7 and 30 days (daily counts only, no personal
 * data). Filters status and code prefix; sorts created, code, scans; the id breaks ties.
 */
class QrIndexController extends Controller
{
    public const TABLE = 'qr';

    public const DEFAULT_SORT = '-created_at';

    public function __invoke(Request $request, VehiclePresenter $presenter, QrCodes $codes): Response
    {
        /** @var Staff $staff */
        $staff = $request->user('staff');
        $today = QaClock::today($request);
        $from7 = $today->subDays(6)->toDateString();
        $from30 = $today->subDays(29)->toDateString();

        $base = QrCode::query()
            ->with(['vehicle' => fn ($q) => $q->with(['make', 'vehicleModel', 'generation', 'owner:id,username'])])
            ->withSum(['scans as scans_7' => fn (Builder $q) => $q->where('day', '>=', $from7)], 'count')
            ->withSum(['scans as scans_30' => fn (Builder $q) => $q->where('day', '>=', $from30)], 'count');

        $query = QueryBuilder::for($base, $request)
            ->allowedFilters(
                AllowedFilter::callback('status', fn (Builder $q, mixed $value) => $q->where('qr_codes.status', QrStatus::tryFrom(is_string($value) ? $value : '')->value ?? '-'))->delimiter("\u{1}"),
                AllowedFilter::callback('q', fn (Builder $q, mixed $value) => $q->where('qr_codes.code', 'like', addcslashes(strtoupper(str_replace(' ', '', is_string($value) ? $value : '')), '%_\\').'%'))->delimiter("\u{1}"),
            )
            ->allowedSorts('created_at', 'code', 'scans_7', 'scans_30')
            ->defaultSort(self::DEFAULT_SORT);
        $query->getEloquentBuilder()->orderBy('qr_codes.id');

        return Inertia::render('Qr/Index', TableProps::make($query, $request, self::TABLE, $staff, fn (array $rows): array => array_map(fn (QrCode $qr): array => [
            'id' => $qr->id,
            'code' => $qr->code,
            'display_code' => $codes->displayCode($qr->code),
            'status' => $qr->status->value,
            'revoked_reason' => $qr->getAttribute('revoked_reason')?->value,
            'vehicle' => $qr->vehicle === null ? null : ['id' => $qr->vehicle->id, 'title' => $presenter->fullTitle($qr->vehicle), 'deleted' => $qr->vehicle->trashed()],
            'owner' => $qr->vehicle?->owner === null ? null : ['id' => $qr->vehicle->owner->id, 'username' => $qr->vehicle->owner->username],
            'created_at' => $qr->created_at?->toIso8601String(),
            'scans_7' => (int) $qr->getAttribute('scans_7'),
            'scans_30' => (int) $qr->getAttribute('scans_30'),
        ], $rows), self::DEFAULT_SORT));
    }
}
