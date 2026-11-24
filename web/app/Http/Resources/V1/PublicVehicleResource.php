<?php

namespace App\Http\Resources\V1;

use App\Enums\ModStatus;
use App\Enums\ViewSource;
use App\Models\BuildUpdate;
use App\Models\Modification;
use App\Models\Save;
use App\Models\User;
use App\Models\Vehicle;
use App\Services\AppConfig\FeatureFlags;
use App\Services\Garage\BuildGoal;
use App\Services\Garage\VehiclePresenter;
use App\Services\Signature\ShareCards;
use App\Services\Social\VehicleCommentThread;
use App\Services\Social\VehicleHighlights;
use App\Support\PublicUrl;
use App\Support\Viewer;
use Illuminate\Database\Eloquent\Relations\HasMany;
use Illuminate\Http\Request;
use Illuminate\Support\Collection;

/**
 * The vehicle page FS-3 and, later, FS-10. Costs and hidden entries are not here for anybody but the owner, and only what the
 * policy let through reaches this resource at all.
 *
 * @property Vehicle $resource
 */
class PublicVehicleResource extends VehicleCardResource
{
    /** Highlights in the order of FS-3. */
    private const HIGHLIGHT_CATEGORIES = ['wheels_tires', 'suspension', 'exhaust'];

    public const DETAIL_RELATIONS = [
        ...self::RELATIONS, 'owner.avatar', 'owner.cover', 'modifications.category.fields', 'modifications.brand', 'modifications.media', 'modifications.vehicle',
    ];

    /**
     * @return array<string, mixed>
     */
    public function toArray(Request $request): array
    {
        $vehicle = $this->resource;
        $viewer = Viewer::from($request);
        $locale = app()->getLocale();
        $display = Viewer::powerDisplay($viewer);
        $presenter = app(VehiclePresenter::class);
        $specs = $vehicle->specs;
        $isOwner = $vehicle->isOwnedBy($viewer);

        ModificationRowResource::loadLinks($vehicle->modifications);

        /** @var Collection<int, Modification> $mods */
        $mods = $vehicle->modifications->sortBy([['sort', 'asc'], ['id', 'asc']])->values()->toBase();
        $plans = $mods->filter(fn (Modification $mod): bool => $mod->getAttribute('status') === ModStatus::Planned)
            ->sortBy([
                fn (Modification $a, Modification $b): int => ($a->getAttribute('plan_sort') ?? PHP_INT_MAX) <=> ($b->getAttribute('plan_sort') ?? PHP_INT_MAX),
                ['sort', 'asc'],
                ['id', 'asc'],
            ])
            ->values();

        return [
            ...parent::toArray($request),
            /** The web page of this vehicle, for sharing: the canonical address (no redirect for a link preview), HTTPS where the site is. */
            'canonical_url' => PublicUrl::absolute('/v/'.$vehicle->canonicalSlug()),
            /**
             * M5.7: the address the share sheet uses: the canonical one with `?via=share`, so a view through it counts as "geteilter Link"
             * in the owner's statistics (canonical, OG and JSON-LD stay on the plain address).
             */
            'share_url' => PublicUrl::absolute('/v/'.$vehicle->canonicalSlug().'?via='.ViewSource::SHARE_PARAMETER),
            /** @var string|null */
            'description' => $vehicle->getAttribute('description'),
            /**
             * M5.9b STREET DEX: the car's Dex number ("Nr. 0087"), public like on the share card and DEX-04; null for a draft.
             *
             * @var int|null
             */
            'dex_number' => $vehicle->dex_number,
            /**
             * "510 PS (375 kW)" in the viewer's setting, what was entered, and the provenance label.
             *
             * @var array{label: string, value: float, unit: string, ps: float, source: string|null, source_label: string|null}|null
             */
            'power' => $specs === null ? null : $presenter->power($specs, $display, $locale),
            /** @var array{label: string, nm: int, source: string|null, source_label: string|null}|null */
            'torque' => $specs === null ? null : $presenter->torque($specs, $locale),
            /**
             * The tables of the Technik tab: Fahrzeug, Motor, Leistung, Antrieb.
             *
             * @var list<array{key: string, label: string, rows: list<array{key: string, label: string, value: string, source: string|null, source_label: string|null}>}>
             */
            'spec_groups' => $presenter->specGroups($vehicle, $display, $locale),
            /** @var array<int, MediaResource> */
            'photos' => MediaResource::collection($this->photosFor($viewer)),
            /** @var array<int, ModificationRowResource> */
            'highlights' => ModificationRowResource::collection($this->highlights($mods)),
            /**
             * M4.9 VEH-01 "Highlights": the owner's pinned rail (build updates and photos, in their order) the reader may see. `highlights`
             * above stays the top mods per category for older apps.
             *
             * @var list<HighlightResource>
             */
            'highlights_rail' => HighlightResource::collection(app(VehicleHighlights::class)->visible($vehicle, Viewer::from($request))),
            /**
             * Groups by category, in the order of the catalogue. count is what "Alle Mods (14)" shows.
             *
             * @var array{count: int, groups: list<array{category: array{key: string, name: string, icon: string|null}, count: int, items: array<int, ModificationRowResource>}>}
             */
            'mods' => [
                'count' => $mods->count(),
                'groups' => $this->groups($mods, $locale),
            ],
            /**
             * M5.3 "Pläne" (10 §5.9): the planned mods in the owner's order (PUT vehicles/{id}/plans/order). They stay in `mods` too, for
             * apps before 2.1 and WEB-01; the 2.1 app leaves status `planned` out of its Mods section. The budget is the owner's alone.
             *
             * @var array{count: int, items: array<int, ModificationRowResource>}
             */
            'plans' => [
                'count' => $plans->count(),
                'items' => ModificationRowResource::collection($plans),
            ],
            /**
             * M5.3 Build-Fortschritt (10 §6.2): built ÷ (built + planned), from the rows above alone (installed and planned; removed parts
             * are not part of the build). Null without either. Same audience as the page: no money, no social counts.
             *
             * @var array{built: int, planned: int, total: int, percent: int}|null
             */
            'build_progress' => $this->buildProgress($mods),
            /**
             * M5.7 (10 §6.2): the owner's optional milestone goal, shown with the Build-Fortschritt ("Ziel: Saison 2027"); `passed` once its
             * year is over (the app shows a passed goal to the owner only). Null when not set.
             *
             * @var array{season: int, label: string, passed: bool}|null
             */
            'build_goal' => BuildGoal::present($vehicle),
            'updates_count' => $this->updatesQuery($viewer)->count(),
            /**
             * The latest entries of Verlauf; the rest through public/vehicles/{slug}/updates.
             *
             * @var array<int, BuildUpdateResource>
             */
            'updates' => BuildUpdateResource::collection(
                $this->updatesQuery($viewer)
                    ->latest('created_at')
                    ->latest('id')
                    ->limit(config()->integer('speedclub.garage.public_updates_on_page'))
                    ->get()
            ),
            /**
             * Null for everybody but the owner when the owner asked not to be named on the page a sticker leads to (`show_owner_on_qr`
             * off). This is that page, whether reached by a scan, a link or the app, as WEB-01 is.
             */
            'owner' => $isOwner || $vehicle->owner?->getAttribute('show_owner_on_qr') !== false ? new MemberProfileResource($vehicle->owner) : null,
            /**
             * [SIG sig.share_cards] The VEH-07 share cards, PNG, 1080 × 1920 (`story`) and 1080 × 1080 (`square`), immutable: the URL changes
             * with what the card shows. A format is null while it is being drawn (it is queued then), for a private build (its card is
             * never stored) and without a usable photo: GET vehicles/{id}/share-card.png?format= draws it at once. Null while the flag is off.
             *
             * @var array{story: string|null, square: string|null}|null
             */
            'share_card_url' => app(FeatureFlags::class)->enabled('sig.share_cards') ? app(ShareCards::class)->urls($vehicle) : null,
            'is_owner' => $isOwner,
            /**
             * The viewer saved this build [SIG sig.saved_builds]. Null for guests, for the owner and while the flag is off.
             */
            'is_saved' => $viewer === null || $isOwner || ! app(FeatureFlags::class)->enabled('sig.saved_builds')
                ? null
                : Save::query()->where('user_id', $viewer->id)->where('vehicle_id', $vehicle->id)->exists(),
            /**
             * M4.11 (09 §8.5, §8.6): the viewer's own reaction and build follow. Counts (reactions by kind, followers) only for the owner;
             * nobody else ever receives them. Each part is null while its flag is off.
             */
            'social' => new VehicleSocialResource($vehicle),
            /**
             * R5-5 [build_comments]: the car's own comment thread on VEH-01 (GET/POST vehicles/{id}/comments). enabled: the thread is
             * open (flag on, the owner allows comments); can_write: this reader may write now (false for guests). Never a count.
             *
             * @var array{enabled: bool, can_write: bool}
             */
            'comment_thread' => app(VehicleCommentThread::class)->state($vehicle, $viewer),
        ];
    }

    /**
     * Hidden entries stay with the owner; M4.11: followers-only posts reach followers of the owner or the vehicle (BuildUpdate::visibleTo).
     *
     * @return HasMany<BuildUpdate, Vehicle>
     */
    private function updatesQuery(?User $viewer): HasMany
    {
        return $this->resource->buildUpdates()->visibleTo($viewer, $this->resource);
    }

    /**
     * @param  Collection<int, Modification>  $mods
     * @return Collection<int, Modification>
     */
    private function highlights(Collection $mods): Collection
    {
        $highlights = [];

        foreach (self::HIGHLIGHT_CATEGORIES as $category) {
            $mod = $mods->first(fn (Modification $mod): bool => $mod->category->key === $category && $mod->getAttribute('status') === ModStatus::Installed);

            if ($mod !== null) {
                $highlights[] = $mod;
            }
        }

        return new Collection($highlights);
    }

    /**
     * @param  Collection<int, Modification>  $mods
     * @return array{built: int, planned: int, total: int, percent: int}|null
     */
    private function buildProgress(Collection $mods): ?array
    {
        $built = $mods->filter(fn (Modification $mod): bool => $mod->getAttribute('status') === ModStatus::Installed)->count();
        $planned = $mods->filter(fn (Modification $mod): bool => $mod->getAttribute('status') === ModStatus::Planned)->count();
        $total = $built + $planned;

        if ($total === 0) {
            return null;
        }

        return ['built' => $built, 'planned' => $planned, 'total' => $total, 'percent' => intdiv($built * 100, $total)];
    }

    /**
     * @param  Collection<int, Modification>  $mods
     * @return list<array{category: array{key: string, name: string, icon: string|null}, count: int, items: mixed}>
     */
    private function groups(Collection $mods, string $locale): array
    {
        $groups = [];

        foreach ($mods->groupBy('category_id')->sortBy(fn (Collection $group): mixed => $group->first()?->category->getAttribute('sort')) as $group) {
            /** @var Collection<int, Modification> $group */
            /** @var Modification $first */
            $first = $group->first();
            $category = $first->category;

            $groups[] = [
                'category' => [
                    'key' => $category->key,
                    'name' => $category->getTranslation('name', $locale),
                    'icon' => $category->getAttribute('icon'),
                ],
                'count' => $group->count(),
                'items' => ModificationRowResource::collection($group->values()),
            ];
        }

        return $groups;
    }

    /**
     * This page has its own count of the entries the reader may see (`updates_count` below), so the card's owner count is not read.
     */
    protected function ownerUpdatesCount(Vehicle $vehicle, ?User $viewer): ?int
    {
        return null;
    }
}
