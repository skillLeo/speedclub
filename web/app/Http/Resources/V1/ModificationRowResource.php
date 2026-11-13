<?php

namespace App\Http\Resources\V1;

use App\Enums\ModStatus;
use App\Models\Media;
use App\Models\Modification;
use App\Services\AppConfig\FeatureFlags;
use App\Services\Garage\ModPresenter;
use App\Services\Garage\VehiclePresenter;
use App\Support\Units;
use App\Support\ViewAs;
use App\Support\Viewer;
use Carbon\CarbonInterface;
use Illuminate\Http\Request;
use Illuminate\Http\Resources\Json\JsonResource;
use Illuminate\Support\Collection;

/**
 * One row of FS-3 Highlights and the Mods tab, and of GAR-09. The cost is the owner's alone (09 §11, M4.9 ruling: costs are never public): for anybody else
 * the field is null, and the amount never leaves the server.
 *
 * @property Modification $resource
 */
class ModificationRowResource extends JsonResource
{
    /**
     * @return array<string, mixed>
     */
    public function toArray(Request $request): array
    {
        $mod = $this->resource;
        $locale = app()->getLocale();
        /** @var array<string, mixed> $fields */
        $fields = $mod->getAttribute('fields') ?? [];
        $category = $mod->category;
        $thumb = $this->photos($request)->first();
        $legal = app(FeatureFlags::class)->enabled('sig.mod_legal_status') ? $mod->getAttribute('legal_status') : null;
        $installed = $mod->getAttribute('installed_on');

        return [
            /** @var string */
            'id' => $mod->getKey(),
            'title' => (string) $mod->getAttribute('title'),
            /** @var array{key: string, name: string, icon: string|null} */
            'category' => [
                'key' => $category->key,
                'name' => $category->getTranslation('name', $locale),
                'icon' => $category->getAttribute('icon'),
            ],
            /** Catalogue name or free text. */
            'brand' => $this->brandName(),
            /**
             * "BBS LM · 19″ × 9,5J ET35 · 255/35 R19"
             */
            'summary_line' => app(ModPresenter::class)->summaryLine((string) $mod->getAttribute('title'), $category, $fields, $locale),
            /** @var ModStatus */
            'status' => $mod->getAttribute('status'),
            /** "Verbaut" */
            'status_label' => $mod->getAttribute('status')->label($locale),
            /**
             * YYYY-MM
             *
             * @var string|null
             */
            'installed_on' => $installed instanceof CarbonInterface ? $installed->format('Y-m') : null,
            /**
             * "März 2023"
             *
             * @var string|null
             */
            'installed_label' => $installed instanceof CarbonInterface ? $installed->copy()->locale($locale)->translatedFormat('F Y') : null,
            /**
             * Always false since M4.9 (09 §11, ADR ruling): costs are never public. Kept for older apps.
             *
             * @var bool
             */
            'cost_public' => false,
            /**
             * The owner's alone (never another member, a guest, a public page or staff in view-as).
             *
             * @var array{cents: int, label: string}|null
             */
            'cost' => $this->cost($request, $locale),
            /**
             * Null while the flag sig.mod_legal_status is off.
             *
             * @var string|null
             */
            'legal_status' => $legal?->value,
            /** @var string|null */
            'legal_status_label' => $legal?->label($locale),
            /** @var MediaResource|null */
            'thumb' => $thumb === null ? null : new MediaResource($thumb),
        ];
    }

    /**
     * @return Collection<int, Media>
     */
    protected function photos(Request $request): Collection
    {
        $asOwner = $this->resource->vehicle->isOwnedBy(Viewer::from($request));

        return $this->resource->media
            ->filter(fn (Media $media): bool => app(VehiclePresenter::class)->photoVisibleTo($media, $asOwner))
            ->sortBy([['sort', 'asc'], ['id', 'asc']])
            ->values()
            ->toBase();
    }

    private function brandName(): ?string
    {
        /** @var string|null $name */
        $name = $this->resource->brand?->getAttribute('name') ?? $this->resource->getAttribute('brand_text');

        return $name;
    }

    /**
     * @return array{cents: int, label: string}|null
     */
    private function cost(Request $request, string $locale): ?array
    {
        $mod = $this->resource;
        $cents = $mod->getAttribute('cost_cents');

        // ADR-441: a private cost is the owner's alone, never staff's in view-as.
        if (! is_int($cents) || ! $mod->vehicle->isOwnedBy(Viewer::from($request)) || ViewAs::active()) {
            return null;
        }

        return ['cents' => $cents, 'label' => (string) __('garage.cost', ['amount' => Units::formatMoney($cents, $locale)], $locale)];
    }
}
