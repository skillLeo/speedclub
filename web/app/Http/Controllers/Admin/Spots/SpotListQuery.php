<?php

namespace App\Http\Controllers\Admin\Spots;

use App\Http\Controllers\Admin\Support\MediaUrls;
use App\Models\Spot;
use App\Services\Admin\Spots\SpotSignals;
use App\Services\Garage\VehiclePresenter;
use Illuminate\Database\Eloquent\Builder;
use Illuminate\Http\Request;
use Illuminate\Support\Carbon;
use Spatie\QueryBuilder\AllowedFilter;
use Spatie\QueryBuilder\QueryBuilder;

/**
 * ADM-62's query (m5.9b contract §7): every spot, newest first, with whitelisted filters — status (active by default, removed, all),
 * from/to (Europe/Berlin days), city (name prefix or GeoNames id), car (Dex number "#12" or "12", else public id or slug prefix),
 * spotter (@username prefix) and signal (any, burst, device, hop; SpotSignals) — and the sort spotted_at (created_at), the id as
 * tie-breaker. A row names the city only: spots have no coordinates.
 */
final class SpotListQuery
{
    public const TABLE = 'spots';

    public const DEFAULT_SORT = '-created_at';

    /**
     * @return QueryBuilder<Spot>
     */
    public static function build(Request $request, SpotSignals $signals): QueryBuilder
    {
        $base = Spot::query()->withTrashed()->with([
            'spotter:id,username',
            'city:id,name,bundesland',
            'vehicle' => fn ($vehicle) => $vehicle->with(['make', 'vehicleModel', 'generation', 'cover']),
        ]);

        [$from, $to] = self::period($request);

        $query = QueryBuilder::for($base, $request)
            ->allowedFilters(
                AllowedFilter::callback('status', function (Builder $q, mixed $value): void {
                    match ($value) {
                        'removed' => $q->whereNotNull('spots.deleted_at'),
                        'all' => null,
                        default => $q->whereNull('spots.deleted_at'),
                    };
                })->default('active')->delimiter("\u{1}"),
                AllowedFilter::callback('from', fn (Builder $q) => $from === null ? null : $q->where('spots.created_at', '>=', $from))->delimiter("\u{1}"),
                AllowedFilter::callback('to', fn (Builder $q) => $to === null ? null : $q->where('spots.created_at', '<=', $to))->delimiter("\u{1}"),
                AllowedFilter::callback('city', function (Builder $q, mixed $value): void {
                    $text = trim(is_string($value) ? $value : '');
                    if ($text === '') {
                        return;
                    }
                    ctype_digit($text)
                        ? $q->where('spots.city_id', (int) $text)
                        : $q->whereHas('city', fn (Builder $city) => $city->where('name', 'like', self::prefix($text))->orWhere('ascii_name', 'like', self::prefix($text)));
                })->delimiter("\u{1}"),
                AllowedFilter::callback('car', function (Builder $q, mixed $value): void {
                    $text = trim(is_string($value) ? $value : '');
                    $number = ltrim($text, '#');
                    if ($text === '') {
                        return;
                    }
                    $q->whereHas('vehicle', fn (Builder $vehicle) => ctype_digit($number)
                        ? $vehicle->where('dex_number', (int) $number)
                        : $vehicle->where(fn (Builder $w) => $w->where('public_id', strtoupper($text))->orWhere('slug', 'like', self::prefix(mb_strtolower($text)))));
                })->delimiter("\u{1}"),
                AllowedFilter::callback('spotter', function (Builder $q, mixed $value): void {
                    $text = ltrim(trim(is_string($value) ? $value : ''), '@');
                    if ($text !== '') {
                        $q->whereHas('spotter', fn (Builder $user) => $user->where('username', 'like', self::prefix(mb_strtolower($text))));
                    }
                })->delimiter("\u{1}"),
                AllowedFilter::callback('signal', fn (Builder $q, mixed $value) => $signals->constrain($q, is_string($value) ? $value : '', $from, $to))->delimiter("\u{1}"),
            )
            ->allowedSorts('created_at')
            ->defaultSort(self::DEFAULT_SORT);

        $query->getEloquentBuilder()->orderByDesc('spots.id');

        return $query;
    }

    /**
     * @param  list<Spot>  $spots
     * @return list<array<string, mixed>>
     */
    public static function rows(array $spots, SpotSignals $signals): array
    {
        $presenter = app(VehiclePresenter::class);
        $flags = $signals->forSpots($spots);

        return array_map(fn (Spot $spot): array => [
            'id' => $spot->id,
            'spotted_at' => $spot->created_at?->toIso8601String(),
            'spotter' => ['id' => $spot->spotter_id, 'username' => $spot->spotter?->username],
            'vehicle' => [
                'id' => $spot->vehicle_id,
                'title' => $presenter->fullTitle($spot->vehicle),
                'dex_number' => $spot->vehicle->dex_number,
                'cover' => MediaUrls::at($spot->vehicle->cover, 64),
                'cover_focus' => MediaUrls::focus($spot->vehicle->cover),
                'cover_placeholder' => MediaUrls::placeholder($spot->vehicle->cover),
            ],
            'city' => $spot->city?->name,
            'bundesland' => $spot->bundesland?->value,
            'counted' => $spot->counted,
            'night' => $spot->is_night,
            'first_three' => $spot->is_first_three,
            'source' => $spot->source->value,
            'removed_at' => $spot->getAttribute('deleted_at')?->toIso8601String(),
            'signals' => $flags[$spot->id] ?? ['burst' => null, 'device' => null, 'hop' => null],
        ], $spots);
    }

    /**
     * filter[from] / filter[to] as UTC instants of the start and end of their Europe/Berlin day; null when absent or not a date.
     *
     * @return array{0: Carbon|null, 1: Carbon|null}
     */
    public static function period(Request $request): array
    {
        $filter = $request->query('filter');
        $day = function (mixed $value): ?Carbon {
            return is_string($value) && preg_match('/^\d{4}-\d{2}-\d{2}$/', $value) === 1 ? Carbon::parse($value, 'Europe/Berlin') : null;
        };
        $from = is_array($filter) ? $day($filter['from'] ?? null) : null;
        $to = is_array($filter) ? $day($filter['to'] ?? null) : null;

        return [$from?->startOfDay()->utc(), $to?->endOfDay()->utc()];
    }

    private static function prefix(string $text): string
    {
        return addcslashes($text, '%_\\').'%';
    }
}
