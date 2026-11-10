<?php

namespace App\Http\Resources\V1;

use App\Enums\MediaStatus;
use App\Models\Media;
use App\Models\Modification;
use App\Services\AppConfig\FeatureFlags;
use App\Services\Discover\SearchFilterResolver;
use App\Services\Garage\ModPresenter;
use App\Support\Viewer;
use Illuminate\Http\Request;

/**
 * The whole modification: VEH-02 reads `specs`, the owner's editor GAR-10 reads `fields`, which is null for anybody else.
 *
 * @property Modification $resource
 */
class ModificationResource extends ModificationRowResource
{
    /**
     * @return array<string, mixed>
     */
    public function toArray(Request $request): array
    {
        $mod = $this->resource;
        /** @var array<string, mixed> $fields */
        $fields = $mod->getAttribute('fields') ?? [];
        $isOwner = $mod->vehicle->isOwnedBy(Viewer::from($request));

        return [
            ...parent::toArray($request),
            'vehicle_id' => $mod->vehicle_id,
            /** @var int|null */
            'brand_id' => $mod->getAttribute('brand_id'),
            /** @var string|null */
            'brand_text' => $mod->getAttribute('brand_text'),
            /** @var string|null */
            'part_name' => $mod->getAttribute('part_name'),
            /** @var string|null */
            'part_number' => $mod->getAttribute('part_number'),
            /**
             * The owner's, null for anybody else (ADR-142).
             *
             * @var string|null
             */
            'notes' => $isOwner ? $mod->getAttribute('notes') : null,
            /** @var int */
            'sort' => $mod->getAttribute('sort'),
            /**
             * Labelled rows of the category, in the viewer's language and number format.
             *
             * @var list<array{key: string, label: string, value: string}>
             */
            'specs' => app(ModPresenter::class)->specRows($mod->category, $fields, app()->getLocale()),
            /**
             * The stored values, for the owner's form.
             *
             * @var array<string, bool|float|int|string>|null
             */
            'fields' => $isOwner ? (object) $fields : null,
            /** "Angaben des Besitzers, keine rechtliche Prüfung", when a legal status is shown. */
            'legal_disclaimer' => app(FeatureFlags::class)->enabled('sig.mod_legal_status') ? (string) __('garage.legal_disclaimer') : null,
            /** @var array<int, MediaResource> */
            'photos' => MediaResource::collection($this->photos($request)),
            /**
             * Owner only, empty for anybody else (ADR-181 revisit, M2.7): photos of this mod whose upload failed for good, shown on GAR-10 as
             * GAR-07 shows a vehicle's, delete only (DELETE media/{id}); media:prune removes them after 30 days. Never in `photos`.
             *
             * @var array<int, MediaResource>
             */
            'failed_photos' => MediaResource::collection($isOwner
                ? $mod->media->filter(fn (Media $media): bool => $media->status === MediaStatus::Failed)->sortBy([['created_at', 'asc'], ['id', 'asc']])->values()
                : collect()),
            /**
             * The DISC-02 filter values of this part, for "Ähnliche suchen" on VEH-02 (M2.3): open `search/vehicles` with them. A brand
             * only when it is a catalogue brand, the diameter only for wheels, type only for suspension.
             *
             * @var array{mod_category: string, wheel_brand: string|null, wheel_diameter: float|null, suspension_type: string|null, suspension_brand: string|null, exhaust_brand: string|null}
             */
            'search' => $this->search($fields),
        ];
    }

    /**
     * @param  array<string, mixed>  $fields
     * @return array{mod_category: string, wheel_brand: string|null, wheel_diameter: float|null, suspension_type: string|null, suspension_brand: string|null, exhaust_brand: string|null}
     */
    private function search(array $fields): array
    {
        $mod = $this->resource;
        $key = $mod->category->key;
        $brand = $mod->brand;
        $canonical = $brand === null ? null : ($brand->mergedInto ?? $brand);
        $slug = $canonical === null ? null : (string) $canonical->getAttribute('slug');
        $diameter = $fields['diameter'] ?? null;
        $type = $fields['type'] ?? null;

        return [
            'mod_category' => $key,
            'wheel_brand' => $key === 'wheels_tires' ? $slug : null,
            'wheel_diameter' => $key === 'wheels_tires' && is_numeric($diameter) ? (float) SearchFilterResolver::diameter((float) $diameter) : null,
            'suspension_type' => $key === 'suspension' && is_string($type) && $type !== '' ? $type : null,
            'suspension_brand' => $key === 'suspension' ? $slug : null,
            'exhaust_brand' => $key === 'exhaust' ? $slug : null,
        ];
    }
}
