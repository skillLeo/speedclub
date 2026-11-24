<?php

namespace App\Http\Resources\V1;

use App\Enums\BusinessStatus;
use App\Enums\ModPriority;
use App\Enums\ModStatus;
use App\Enums\ProductStatus;
use App\Models\Business;
use App\Models\Media;
use App\Models\Modification;
use App\Models\Product;
use App\Services\AppConfig\FeatureFlags;
use App\Services\BuildScore\BuildScoreInputs;
use App\Services\Garage\ModPresenter;
use App\Services\Garage\VehiclePresenter;
use App\Services\Showcase\SampleContent;
use App\Support\Units;
use App\Support\ViewAs;
use App\Support\Viewer;
use Carbon\CarbonInterface;
use Illuminate\Database\Eloquent\Collection as EloquentCollection;
use Illuminate\Http\Request;
use Illuminate\Http\Resources\Json\JsonResource;
use Illuminate\Support\Carbon;
use Illuminate\Support\Collection;
use Illuminate\Support\Facades\Gate;

/**
 * One row of FS-3 Highlights and the Mods tab, and of GAR-09. The cost is the owner's alone (09 §11, M4.9 ruling: costs are never public): for anybody else
 * the field is null, and the amount never leaves the server. M5.3: the same holds for a plan's budget.
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
            ...$this->plan($request, $locale),
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
            /**
             * M5.9c "TÜV-eingetragen": the owner states the mod is entered in the vehicle papers (legal_status registered or
             * individual_approval). The owner's statement, never our judgement; false while sig.mod_legal_status is off.
             */
            'is_registered' => $legal !== null && in_array($legal, BuildScoreInputs::REGISTERED, true),
            /** @var MediaResource|null */
            'thumb' => $thumb === null ? null : new MediaResource($thumb),
            /**
             * M4.14 (09 §8.9): the linked catalogue product, so the Mods tab links BRD-02 and the brand links BRD-01; null without one and
             * while parts_catalogue is off. `brand_slug` repeats `brand.slug` for older apps.
             *
             * @var array{id: string, name: string, full_name: string, brand: array{slug: string, name: string}, brand_slug: string, archived: bool}|null
             */
            'product' => $this->product(),
            /**
             * M4.14 (09 §8.10): "Eingebaut von", only once the business and the owner both confirmed the tag and the reader may see the
             * business; null otherwise and while businesses is off. `verified` is never true on a sample business (DQ-1144).
             *
             * @var array{slug: string, name: string, city: string, verified: bool}|null
             */
            'installed_by' => $this->installedBy($request),
        ];
    }

    /**
     * Loads what `product` and `installed_by` read for a list of mods, only for the mods that link one and only while its flag is on, so
     * a page whose mods link nothing costs no query (the vehicle page's fixed query budget). The rest read as null without a query.
     *
     * @param  EloquentCollection<int, Modification>  $mods
     */
    public static function loadLinks(EloquentCollection $mods): void
    {
        $links = ['product' => ['product_id', 'product.brand', 'parts_catalogue'], 'installedBy' => ['installed_by_business_id', 'installedBy.owner', 'businesses']];

        foreach ($links as $relation => [$column, $load, $flag]) {
            $linked = $mods->filter(fn (Modification $mod): bool => $mod->getAttribute($column) !== null && ! $mod->relationLoaded($relation));

            // The flag is read only when a mod links something, so a page without links costs no query at all.
            if ($linked->isNotEmpty() && app(FeatureFlags::class)->enabled($flag)) {
                (new EloquentCollection($linked->all()))->load($load);
            }

            $mods->each(function (Modification $mod) use ($relation): void {
                if (! $mod->relationLoaded($relation)) {
                    $mod->setRelation($relation, null);
                }
            });
        }
    }

    /**
     * @return array{id: string, name: string, full_name: string, brand: array{slug: string, name: string}, brand_slug: string, archived: bool}|null
     */
    private function product(): ?array
    {
        if ($this->resource->getAttribute('product_id') === null || ! app(FeatureFlags::class)->enabled('parts_catalogue') || ! ($product = $this->resource->product) instanceof Product) {
            return null;
        }

        return [
            'id' => $product->id,
            'name' => $product->name,
            'full_name' => $product->fullName(),
            'brand' => ['slug' => $product->brand->slug, 'name' => $product->brand->name],
            'brand_slug' => $product->brand->slug,
            'archived' => $product->status === ProductStatus::Archived,
        ];
    }

    /**
     * Set on the mod only after the double confirmation (ModBusinessTag accepted by both sides); the tag's pending states never reach
     * this field.
     *
     * @return array{slug: string, name: string, city: string, verified: bool}|null
     */
    private function installedBy(Request $request): ?array
    {
        if ($this->resource->getAttribute('installed_by_business_id') === null || ! app(FeatureFlags::class)->enabled('businesses')
            || ! ($business = $this->resource->installedBy) instanceof Business || ! Gate::forUser(Viewer::from($request))->allows('view', $business)) {
            return null;
        }

        return [
            'slug' => $business->slug,
            'name' => $business->name,
            'city' => $business->city,
            'verified' => $business->status === BusinessStatus::Verified && ! SampleContent::isSample($business),
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
     * M5.3 "Pläne" (m5.3-contract §2): the plan fields, null on a mod that is not planned; the budget is the owner's alone, like the cost.
     *
     * @return array{target_month: string|null, target_label: string|null, is_due: bool, priority: ModPriority|null, priority_label: string|null, plan_sort: int|null, budget: array{cents: int, label: string}|null}
     */
    private function plan(Request $request, string $locale): array
    {
        $mod = $this->resource;
        $planned = $mod->getAttribute('status') === ModStatus::Planned;
        $target = $planned ? $mod->getAttribute('target_month') : null;
        $target = $target instanceof CarbonInterface ? $target : null;
        $priority = $planned ? $mod->getAttribute('priority') : null;
        $priority = $priority instanceof ModPriority ? $priority : null;
        $sort = $planned ? $mod->getAttribute('plan_sort') : null;
        $now = Carbon::now(config()->string('speedclub.display_timezone'))->format('Y-m');

        return [
            /**
             * M5.3: the target month of a plan as YYYY-MM; null for a mod that is not planned or a plan without one.
             *
             * @var string|null
             */
            'target_month' => $target?->format('Y-m'),
            /**
             * "März 2027"
             *
             * @var string|null
             */
            'target_label' => $target?->copy()->locale($locale)->translatedFormat('F Y'),
            /** M5.3: a plan whose target month has come (Europe/Berlin); false for anything else. */
            'is_due' => $target !== null && $target->format('Y-m') <= $now,
            /**
             * M5.3: optional priority of a plan.
             *
             * @var ModPriority|null
             */
            'priority' => $priority,
            /**
             * "Hoch"
             *
             * @var string|null
             */
            'priority_label' => $priority?->label($locale),
            /**
             * M5.3: the owner's order of the plans (PUT vehicles/{id}/plans/order); null for a mod that is not planned.
             *
             * @var int|null
             */
            'plan_sort' => is_int($sort) ? $sort : null,
            /**
             * M5.3: the planned budget, the owner's alone like `cost` (never another member, a guest, a public page or staff in view-as).
             *
             * @var array{cents: int, label: string}|null
             */
            'budget' => $this->privateAmount($request, 'budget_cents', 'garage.budget', $locale),
        ];
    }

    /**
     * @return array{cents: int, label: string}|null
     */
    private function cost(Request $request, string $locale): ?array
    {
        return $this->privateAmount($request, 'cost_cents', 'garage.cost', $locale);
    }

    /**
     * @return array{cents: int, label: string}|null
     */
    private function privateAmount(Request $request, string $column, string $label, string $locale): ?array
    {
        $mod = $this->resource;
        $cents = $mod->getAttribute($column);

        // ADR-441: a private cost or budget is the owner's alone, never staff's in view-as.
        if (! is_int($cents) || ! $mod->vehicle->isOwnedBy(Viewer::from($request)) || ViewAs::active()) {
            return null;
        }

        return ['cents' => $cents, 'label' => (string) __($label, ['amount' => Units::formatMoney($cents, $locale)], $locale)];
    }
}
