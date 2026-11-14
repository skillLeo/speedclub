<?php

namespace App\Http\Controllers\Admin\Editorial;

use App\Enums\EventStatus;
use App\Enums\SampleItemType;
use App\Enums\Visibility;
use App\Http\Controllers\Admin\Support\MediaUrls;
use App\Models\Business;
use App\Models\Event;
use App\Models\Vehicle;
use App\Services\Garage\VehiclePresenter;
use App\Services\Showcase\SampleInventory;
use Carbon\CarbonImmutable;
use Illuminate\Database\Eloquent\Builder;
use Illuminate\Database\Eloquent\Model;
use Illuminate\Database\Query\Builder as BaseBuilder;
use Illuminate\Http\Request;
use Spatie\QueryBuilder\AllowedFilter;
use Spatie\QueryBuilder\QueryBuilder;

/**
 * ADM-58's tables (09 §8.19): the sample builds, meets and businesses (their own is_sample or their owner's), filters q (name) and
 * state (shown · hidden), sort by creation. The row says how members see the item now: `hidden` (ADM-58 took it out, with who, when
 * and why), `withdrawn` (private or removed by other means: moderation or the Editorial account) or `shown`.
 */
final class SampleItems
{
    public const TABLE = 'editorial';

    public const DEFAULT_SORT = '-created_at';

    /**
     * @return QueryBuilder<Model>
     */
    public static function build(SampleItemType $type, Request $request): QueryBuilder
    {
        [$base, $table, $name] = match ($type) {
            SampleItemType::Vehicle => [Vehicle::query()->with(['owner:id,username,is_sample', 'make', 'vehicleModel', 'generation', 'cover'])
                ->where(fn (Builder $q) => $q->where('vehicles.is_sample', true)->orWhereHas('owner', fn (Builder $owner) => $owner->where('is_sample', true))), 'vehicles', 'vehicles.nickname'],
            SampleItemType::Event => [Event::query()->with(['organiser:id,username,is_sample', 'cover'])->where('events.status', '!=', EventStatus::Draft->value)
                ->where(fn (Builder $q) => $q->where('events.is_sample', true)->orWhereHas('organiser', fn (Builder $owner) => $owner->where('is_sample', true))), 'events', 'events.title'],
            SampleItemType::Business => [Business::query()->with(['owner:id,username,is_sample', 'cover'])
                ->where(fn (Builder $q) => $q->where('businesses.is_sample', true)->orWhereHas('owner', fn (Builder $owner) => $owner->where('is_sample', true))), 'businesses', 'businesses.name'],
        };
        $open = fn (BaseBuilder $q) => $q->selectRaw('1')->from('sample_hidden_items')->where('sample_hidden_items.subject_type', $type->value)
            ->whereColumn('sample_hidden_items.subject_id', "$table.id")->whereNull('sample_hidden_items.restored_at');

        /** @var Builder<Model> $base */
        $query = QueryBuilder::for($base, $request)
            ->allowedFilters(
                AllowedFilter::callback('q', function (Builder $q, mixed $value) use ($name, $table, $type): void {
                    $term = trim(is_string($value) ? $value : '');

                    if ($term === '') {
                        return;
                    }

                    $like = '%'.addcslashes($term, '%_\\').'%';
                    $q->where(fn (Builder $any) => $type === SampleItemType::Vehicle
                        ? $any->where($name, 'like', $like)->orWhere("$table.slug", 'like', $like)->orWhere("$table.make_text", 'like', $like)->orWhere("$table.model_text", 'like', $like)
                        : $any->where($name, 'like', $like)->orWhere("$table.city", 'like', $like));
                })->delimiter("\u{1}"),
                AllowedFilter::callback('state', fn (Builder $q, mixed $value) => $value === 'hidden' ? $q->whereExists($open) : $q->whereNotExists($open))->delimiter("\u{1}"),
            )
            ->allowedSorts('created_at')
            ->defaultSort(self::DEFAULT_SORT);

        $query->getEloquentBuilder()->orderBy("$table.id");

        return $query;
    }

    /**
     * @param  list<Model>  $items
     * @return list<array<string, mixed>>
     */
    public static function rows(SampleItemType $type, array $items): array
    {
        $ids = array_map(fn (Model $item): string => (string) $item->getKey(), $items);
        $records = SampleInventory::hiddenRecords($type, $ids);
        $presenter = app(VehiclePresenter::class);

        return array_map(function (Model $item) use ($type, $records, $presenter): array {
            $record = $records[(string) $item->getKey()] ?? null;
            [$title, $owner, $cover, $public] = match (true) {
                $item instanceof Vehicle => [$presenter->title($item), $item->owner, $item->cover, $item->visibility !== Visibility::Private],
                $item instanceof Event => [$item->title, $item->organiser, $item->cover, $item->removed_at === null && $item->status->isPublic()],
                $item instanceof Business => [$item->name, $item->owner, $item->cover, $item->isPublic()],
                default => ['', null, null, false],
            };

            return [
                'id' => (string) $item->getKey(),
                'type' => $type->value,
                'title' => $title,
                'caption' => match (true) {
                    // DQ-1204: the title drops the make ("M4 G82"), so the second line names it with the year (and the nickname).
                    $item instanceof Vehicle => implode(' · ', array_filter([$presenter->makeName($item), $item->model_year === null ? null : (string) $item->model_year, $item->getAttribute('nickname')], fn (mixed $part): bool => is_string($part) && $part !== '')) ?: null,
                    $item instanceof Event => $item->city,
                    $item instanceof Business => $item->city,
                    default => null,
                },
                'owner' => $owner?->getAttribute('username'),
                'cover' => MediaUrls::at($cover, 64),
                'cover_placeholder' => MediaUrls::placeholder($cover),
                'state' => $record !== null ? 'hidden' : ($public ? 'shown' : 'withdrawn'),
                'hidden' => $record === null ? null : [
                    'at' => CarbonImmutable::parse((string) $record->hidden_at, 'UTC')->toIso8601String(),
                    'by' => $record->by,
                    'reason' => $record->reason,
                ],
                'created_at' => $item->getAttribute('created_at')?->toIso8601String(),
            ];
        }, $items);
    }

    /**
     * @return array<string, int>
     */
    public static function summary(): array
    {
        return SampleInventory::summary();
    }
}
