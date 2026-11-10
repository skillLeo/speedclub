<?php

namespace App\Http\Controllers\Admin\Content\Support;

use App\Enums\VehicleStatus;
use App\Enums\Visibility;
use App\Http\Controllers\Admin\Support\MediaUrls;
use App\Models\Vehicle;
use App\Services\Garage\VehiclePresenter;
use Illuminate\Database\Eloquent\Builder;

/**
 * The builds ADM-29 curates: a summary per vehicle id (title, owner, thumbnail, whether the public may still see it) and the picker's
 * search over published, non-private builds by title words, slug, public id or the owner's @username.
 */
final class VehicleChoices
{
    public function __construct(private readonly VehiclePresenter $presenter) {}

    /**
     * @param  list<string>  $ids
     * @return array<string, array{id: string, title: string, owner: string|null, slug: string, thumb: string|null, reachable: bool}>
     */
    public function summaries(array $ids): array
    {
        $ids = array_values(array_unique(array_filter($ids)));

        if ($ids === []) {
            return [];
        }

        $rows = Vehicle::query()->withTrashed()->with(['make', 'vehicleModel', 'generation', 'owner:id,username', 'cover'])->whereKey($ids)->get();
        $out = [];

        foreach ($rows as $vehicle) {
            $out[$vehicle->id] = $this->summary($vehicle);
        }

        return $out;
    }

    /**
     * @return list<array{id: string, title: string, owner: string|null, slug: string, thumb: string|null, reachable: bool}>
     */
    public function search(string $term, int $limit = 10): array
    {
        $term = trim(ltrim(trim($term), '@'));

        $query = Vehicle::query()
            ->with(['make', 'vehicleModel', 'generation', 'owner:id,username', 'cover'])
            ->where('status', VehicleStatus::Published)->where('visibility', '!=', Visibility::Private)
            ->orderByDesc('published_at')->orderBy('id')->limit($limit);

        if ($term !== '') {
            $like = '%'.addcslashes(mb_strtolower($term), '%_\\').'%';
            $query->where(fn (Builder $q) => $q->where('slug', 'like', $like)->orWhere('public_id', mb_strtolower($term))
                ->orWhereHas('owner', fn (Builder $owner) => $owner->where('username', 'like', addcslashes(mb_strtolower($term), '%_\\').'%'))
                ->orWhereHas('make', fn (Builder $make) => $make->where('name', 'like', $like))
                ->orWhereHas('vehicleModel', fn (Builder $model) => $model->where('name', 'like', $like)));
        }

        return array_values($query->get()->map(fn (Vehicle $vehicle): array => $this->summary($vehicle))->all());
    }

    /**
     * @return array{id: string, title: string, owner: string|null, slug: string, thumb: string|null, reachable: bool}
     */
    private function summary(Vehicle $vehicle): array
    {
        return [
            'id' => $vehicle->id,
            'title' => $this->presenter->fullTitle($vehicle),
            'owner' => $vehicle->owner?->username,
            'slug' => $vehicle->slug,
            'thumb' => MediaUrls::at($vehicle->cover, 64),
            'reachable' => $vehicle->isReachable(),
        ];
    }
}
