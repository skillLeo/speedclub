<?php

namespace App\Http\Controllers\Admin\Vehicles;

use App\Enums\CaseStatus;
use App\Enums\DecisionAction;
use App\Enums\MediaStatus;
use App\Enums\ModerationStatus;
use App\Enums\ReportTargetType;
use App\Enums\Visibility;
use App\Http\Controllers\Admin\Support\MediaUrls;
use App\Models\ModerationCase;
use App\Models\Vehicle;
use App\Services\Garage\VehiclePresenter;
use Carbon\CarbonImmutable;
use Illuminate\Database\Eloquent\Builder;
use Illuminate\Database\Query\Builder as BaseBuilder;
use Illuminate\Http\Request;
use Spatie\QueryBuilder\AllowedFilter;
use Spatie\QueryBuilder\QueryBuilder;

/**
 * ADM-11's query (m3.2-contract §2): whitelisted filters (make, visibility, moderation status, reported, has QR, updated range, text) and
 * sorts, the id as tie-breaker, and the row. "Hidden" = a remove_content decision no reversal lifted (ModerationHolds::activeRemoval);
 * "reported" = an open case on the vehicle.
 */
final class VehicleListQuery
{
    public const TABLE = 'vehicles';

    public const DEFAULT_SORT = '-updated_at';

    /**
     * @return QueryBuilder<Vehicle>
     */
    public static function build(Request $request): QueryBuilder
    {
        $base = Vehicle::query()
            ->with(['make', 'vehicleModel', 'generation', 'cover', 'owner:id,username', 'activeQrCode'])
            ->withCount(['media as photos_count' => fn (Builder $q) => $q->where('status', MediaStatus::Ready)->where('moderation_status', '!=', ModerationStatus::Rejected), 'modifications']);

        $query = QueryBuilder::for($base, $request)
            ->allowedFilters(
                AllowedFilter::callback('q', function (Builder $q, mixed $value): void {
                    $text = mb_strtolower(trim(is_string($value) ? $value : ''));
                    $like = addcslashes($text, '%_\\').'%';
                    $q->where(fn (Builder $w) => $w->where('vehicles.public_id', strtoupper($text))->orWhere('vehicles.slug', 'like', $like)->orWhere('vehicles.nickname', 'like', $like));
                })->delimiter("\u{1}"),
                AllowedFilter::callback('make', fn (Builder $q, mixed $value) => $q->where('vehicles.make_id', is_numeric($value) ? (int) $value : 0))->delimiter("\u{1}"),
                AllowedFilter::callback('visibility', fn (Builder $q, mixed $value) => $q->where('vehicles.visibility', Visibility::tryFrom(is_string($value) ? $value : '')->value ?? '-'))->delimiter("\u{1}"),
                AllowedFilter::callback('moderation', fn (Builder $q, mixed $value) => $value === 'hidden' ? $q->whereExists(self::removal()) : $q->whereNotExists(self::removal()))->delimiter("\u{1}"),
                AllowedFilter::callback('reported', fn (Builder $q, mixed $value) => self::truthy($value) ? $q->whereExists(self::openCase()) : $q->whereNotExists(self::openCase()))->delimiter("\u{1}"),
                AllowedFilter::callback('has_qr', fn (Builder $q, mixed $value) => self::truthy($value) ? $q->has('activeQrCode') : $q->doesntHave('activeQrCode'))->delimiter("\u{1}"),
                AllowedFilter::callback('updated_from', fn (Builder $q, mixed $value) => $q->where('vehicles.updated_at', '>=', self::day($value)->startOfDay()->utc()))->delimiter("\u{1}"),
                AllowedFilter::callback('updated_to', fn (Builder $q, mixed $value) => $q->where('vehicles.updated_at', '<=', self::day($value)->endOfDay()->utc()))->delimiter("\u{1}"),
            )
            ->allowedSorts('updated_at', 'created_at', 'model_year', 'photos_count', 'modifications_count')
            ->defaultSort(self::DEFAULT_SORT);

        $query->getEloquentBuilder()->orderBy('vehicles.id');

        return $query;
    }

    /**
     * @param  list<Vehicle>  $vehicles
     * @return list<array<string, mixed>>
     */
    public static function rows(array $vehicles): array
    {
        $presenter = app(VehiclePresenter::class);
        $ids = array_map(fn (Vehicle $v): string => $v->id, $vehicles);
        $hidden = self::hiddenAmong($ids);
        $reported = self::reportedAmong($ids);

        return array_map(fn (Vehicle $vehicle): array => [
            'id' => $vehicle->id,
            'public_id' => $vehicle->public_id,
            'slug' => $vehicle->slug,
            'make' => $presenter->makeName($vehicle),
            'title' => $presenter->title($vehicle),
            'nickname' => $vehicle->getAttribute('nickname'),
            'model_year' => $vehicle->model_year,
            'owner' => $vehicle->owner === null ? null : ['id' => $vehicle->owner->id, 'username' => $vehicle->owner->username],
            'status' => $vehicle->status->value,
            'visibility' => $vehicle->visibility->value,
            'hidden' => in_array($vehicle->id, $hidden, true),
            'reported' => in_array($vehicle->id, $reported, true),
            'cover' => MediaUrls::at($vehicle->cover, 64),
            'cover_focus' => MediaUrls::focus($vehicle->cover),
            'cover_placeholder' => MediaUrls::placeholder($vehicle->cover),
            'photos' => (int) $vehicle->getAttribute('photos_count'),
            'mods' => (int) $vehicle->getAttribute('modifications_count'),
            'qr' => $vehicle->activeQrCode?->code,
            'updated_at' => $vehicle->updated_at?->toIso8601String(),
        ], $vehicles);
    }

    /**
     * @param  list<string>  $ids
     * @return list<string>
     */
    public static function hiddenAmong(array $ids): array
    {
        if ($ids === []) {
            return [];
        }

        return array_values(ModerationCase::query()
            ->join('decisions', 'decisions.case_id', '=', 'moderation_cases.id')
            ->where('moderation_cases.target_type', ReportTargetType::Vehicle->value)
            ->whereIn('moderation_cases.target_id', $ids)
            ->where('decisions.action', DecisionAction::RemoveContent->value)
            ->whereNotExists(fn (BaseBuilder $q) => $q->selectRaw('1')->from('decisions as reversals')->whereColumn('reversals.reverses_decision_id', 'decisions.id'))
            ->distinct()
            ->pluck('moderation_cases.target_id')
            ->map(fn (mixed $id): string => (string) $id)
            ->all());
    }

    /**
     * @param  list<string>  $ids
     * @return list<string>
     */
    private static function reportedAmong(array $ids): array
    {
        if ($ids === []) {
            return [];
        }

        return array_values(ModerationCase::query()
            ->where('target_type', ReportTargetType::Vehicle->value)
            ->whereIn('target_id', $ids)
            ->whereIn('status', [CaseStatus::New->value, CaseStatus::InReview->value])
            ->distinct()
            ->pluck('target_id')
            ->map(fn (mixed $id): string => (string) $id)
            ->all());
    }

    /**
     * @return \Closure(BaseBuilder): BaseBuilder
     */
    private static function removal(): \Closure
    {
        return fn (BaseBuilder $q) => $q->selectRaw('1')->from('moderation_cases')
            ->join('decisions', 'decisions.case_id', '=', 'moderation_cases.id')
            ->where('moderation_cases.target_type', ReportTargetType::Vehicle->value)
            ->whereColumn('moderation_cases.target_id', 'vehicles.id')
            ->where('decisions.action', DecisionAction::RemoveContent->value)
            ->whereNotExists(fn (BaseBuilder $r) => $r->selectRaw('1')->from('decisions as reversals')->whereColumn('reversals.reverses_decision_id', 'decisions.id'));
    }

    /**
     * @return \Closure(BaseBuilder): BaseBuilder
     */
    private static function openCase(): \Closure
    {
        return fn (BaseBuilder $q) => $q->selectRaw('1')->from('moderation_cases')
            ->where('moderation_cases.target_type', ReportTargetType::Vehicle->value)
            ->whereColumn('moderation_cases.target_id', 'vehicles.id')
            ->whereIn('moderation_cases.status', [CaseStatus::New->value, CaseStatus::InReview->value]);
    }

    private static function truthy(mixed $value): bool
    {
        return in_array($value, ['1', 1, true, 'true', 'yes'], true);
    }

    private static function day(mixed $value): CarbonImmutable
    {
        $value = is_string($value) && preg_match('/^\d{4}-\d{2}-\d{2}$/', $value) === 1 ? $value : 'today';

        return CarbonImmutable::parse($value, 'Europe/Berlin');
    }
}
