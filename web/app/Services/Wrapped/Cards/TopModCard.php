<?php

namespace App\Services\Wrapped\Cards;

use App\Enums\BuildUpdateKind;
use App\Enums\ModStatus;
use App\Models\BuildUpdate;
use App\Models\Media;
use App\Models\Modification;
use App\Services\Garage\VehiclePresenter;
use App\Services\Wrapped\WrappedContext;
use App\Services\Wrapped\WrappedMedia;
use Illuminate\Database\Eloquent\Builder;

/**
 * Card 5: the member's top mod of the season with before/after (contract §3). First choice: the newest before/after update of the
 * season (M5.9c `kind` before_after, not hidden) whose two photos may be shown and which names an installed mod. Otherwise the season's
 * best documented mod (installed in the season, or added in it without a date): with a photo first, then with a brand, then the newest;
 * its photo is the "after", there is no "before". Photos only through WrappedMedia (blurred or declined plates, ADR-509); stored as ids.
 */
final class TopModCard implements WrappedCard
{
    public function __construct(
        private readonly WrappedMedia $media,
        private readonly VehiclePresenter $presenter,
    ) {}

    public function kind(): string
    {
        return 'top_mod';
    }

    public function build(WrappedContext $context): ?array
    {
        $cars = $context->carIds();

        if ($cars === []) {
            return null;
        }

        return $this->fromBeforeAfter($context, $cars) ?? $this->fromMods($context, $cars);
    }

    /**
     * @param  list<string>  $cars
     * @return array<string, mixed>|null
     */
    private function fromBeforeAfter(WrappedContext $context, array $cars): ?array
    {
        $updates = BuildUpdate::query()
            ->whereIn('vehicle_id', $cars)
            ->where('hidden', false)
            ->where('kind', BuildUpdateKind::BeforeAfter)
            ->whereBetween('created_at', [$context->season->fromUtc(), $context->untilUtc()])
            ->with(['modifications' => fn ($query) => $query->where('status', ModStatus::Installed)])
            ->orderByDesc('created_at')
            ->orderByDesc('id')
            ->limit(20)
            ->get();

        foreach ($updates as $update) {
            $mod = $update->modifications->first();

            foreach ($update->photo_pairs ?? [] as $pair) {
                $before = $this->media->usable($pair[0], $context->member->id);
                $after = $this->media->usable($pair[1], $context->member->id);

                if ($mod instanceof Modification && $before !== null && $after !== null && $before->id !== $after->id) {
                    return $this->card($context, $mod, $before, $after);
                }
            }
        }

        return null;
    }

    /**
     * @param  list<string>  $cars
     * @return array<string, mixed>|null
     */
    private function fromMods(WrappedContext $context, array $cars): ?array
    {
        $season = $context->season;
        $mods = Modification::query()
            ->whereIn('vehicle_id', $cars)
            ->where('status', ModStatus::Installed)
            ->where(fn (Builder $query) => $query
                ->whereBetween('installed_on', [$season->fromDate(), $season->toDate()])
                ->orWhere(fn (Builder $undated) => $undated->whereNull('installed_on')->whereBetween('created_at', [$season->fromUtc(), $context->untilUtc()])))
            ->with(['brand', 'media' => fn ($query) => WrappedMedia::constrain($query->getQuery(), $context->member->id)->orderBy('sort')->orderBy('id')])
            ->get();

        $best = $mods->sort(function (Modification $a, Modification $b): int {
            $key = fn (Modification $mod): array => [
                $mod->media->isNotEmpty() ? 1 : 0,
                $mod->getAttribute('brand_id') !== null || filled($mod->getAttribute('brand_text')) ? 1 : 0,
                (string) $mod->getRawOriginal('installed_on'),
                (string) $mod->id,
            ];

            return $key($b) <=> $key($a);
        })->first();

        if (! $best instanceof Modification) {
            return null;
        }

        $photo = $best->media->first(fn (Media $media): bool => $this->media->usable($media->id, $context->member->id) !== null);

        return $this->card($context, $best, null, $photo);
    }

    /**
     * @return array<string, mixed>|null
     */
    private function card(WrappedContext $context, Modification $mod, ?Media $before, ?Media $after): ?array
    {
        $car = $context->car($mod->vehicle_id);
        $name = trim((string) $mod->getAttribute('title'));

        if ($car === null || $name === '') {
            return null;
        }

        $brand = $mod->brand?->getAttribute('name') ?? $mod->getAttribute('brand_text');

        return [
            'kind' => 'top_mod',
            'modification_id' => $mod->id,
            'vehicle_id' => $car->id,
            'name' => $name,
            'brand' => is_string($brand) && trim($brand) !== '' ? trim($brand) : null,
            'vehicle_name' => $this->presenter->fullTitle($car),
            'before_media_id' => $before?->id,
            'after_media_id' => $after?->id,
        ];
    }
}
