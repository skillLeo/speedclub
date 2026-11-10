<?php

namespace App\Http\Resources\V1;

use App\Models\Media;
use App\Models\User;
use App\Models\Vehicle;
use App\Services\Garage\VehicleCompleteness;
use App\Services\Garage\VehiclePresenter;
use App\Services\Qr\QrCodes;
use App\Support\Viewer;
use Illuminate\Http\Request;
use Illuminate\Http\Resources\Json\JsonResource;
use Illuminate\Support\Collection;

/**
 * A vehicle in a list (FS-4 cards and drafts, the garage of a profile): what the card displays, in the viewer's units and
 * language. completeness, wizard and qr are for the owner, null for anybody else.
 *
 * @property Vehicle $resource
 */
class VehicleCardResource extends JsonResource
{
    /** What toArray reads; load it for a list. */
    public const RELATIONS = ['make', 'vehicleModel', 'generation', 'specs', 'cover', 'media', 'activeQrCode'];

    /**
     * @return array<string, mixed>
     */
    public function toArray(Request $request): array
    {
        $vehicle = $this->resource;
        $viewer = Viewer::from($request);
        $locale = app()->getLocale();
        $presenter = app(VehiclePresenter::class);
        $isOwner = $vehicle->isOwnedBy($viewer);
        $cover = $this->coverFor($viewer);
        $qr = $isOwner ? $vehicle->activeQrCode : null;

        return [
            'id' => $vehicle->id,
            'public_id' => $vehicle->public_id,
            'slug' => $vehicle->slug,
            'status' => $vehicle->status,
            'visibility' => $vehicle->visibility,
            'is_main' => $vehicle->is_main,
            /**
             * "NISSAN". Null while a draft has no make.
             *
             * @var string|null
             */
            'eyebrow' => $presenter->eyebrow($vehicle),
            /**
             * Catalogue name or free text. Null while a draft has no make.
             *
             * @var string|null
             */
            'make' => $presenter->makeName($vehicle),
            /**
             * Catalogue name or free text. Null while a draft has no model.
             *
             * @var string|null
             */
            'model' => $presenter->modelName($vehicle),
            'generation' => $vehicle->generation?->name,
            /** "Skyline GT-R R34" */
            'title' => $presenter->title($vehicle),
            /** "Nissan Skyline GT-R R34" */
            'full_title' => $presenter->fullTitle($vehicle),
            /** @var string|null */
            'nickname' => $vehicle->getAttribute('nickname'),
            /** @var string|null */
            'color' => $vehicle->getAttribute('color'),
            'model_year' => $vehicle->model_year,
            /**
             * ["2002", "2,6 l R6 Biturbo (RB26DETT)", "Bayside Blue"]
             *
             * @var list<string>
             */
            'subline_parts' => $presenter->subline($vehicle, $locale),
            /**
             * Four columns: power and torque in the viewer's units, model year, drivetrain. value is null until entered.
             *
             * @var list<array{key: string, value: string|null, unit: string|null, label: string}>
             */
            'spec_strip' => $presenter->specStrip($vehicle, Viewer::powerDisplay($viewer), $locale),
            /** @var MediaResource|null */
            'cover' => $cover === null ? null : new MediaResource($cover),
            'photo_count' => $this->photosFor($viewer)->count(),
            /** @var int */
            'mod_count' => $vehicle->getAttribute('modifications_count') ?? $vehicle->modifications()->count(),
            /** @var string|null */
            'published_at' => $vehicle->getAttribute('published_at')?->toIso8601String(),
            'updated_at' => $vehicle->updated_at?->toIso8601String(),
            /**
             * Where a draft resumes: "Entwurf · Schritt 2 von 4". Null for anything but the owner's draft.
             *
             * @var array{step: int, total_steps: int}|null
             */
            'wizard' => $isOwner && $vehicle->isDraft() ? [
                'step' => $vehicle->wizard_step ?? 1,
                'total_steps' => config()->integer('speedclub.garage.wizard_steps'),
            ] : null,
            /**
             * Owner only.
             *
             * @var array{percent: int, is_complete: bool, line: string, hint: string|null, missing: list<array{key: string, label: string, section: string}>}|null
             */
            'completeness' => $isOwner ? app(VehicleCompleteness::class)->for($vehicle, $locale) : null,
            /**
             * Owner only. The vehicle's active code, from its first publish on.
             *
             * @var array{code: string, url: string}|null
             */
            'qr' => $qr === null ? null : ['code' => $qr->code, 'url' => app(QrCodes::class)->url($qr)],
        ];
    }

    /**
     * Sorted. Others see finished, unrejected photos only; the owner also sees what is still processing or was rejected.
     *
     * @return Collection<int, Media>
     */
    protected function photosFor(?User $viewer): Collection
    {
        return $this->resource->media
            ->filter(fn (Media $media): bool => app(VehiclePresenter::class)->photoVisibleTo($media, $this->resource->isOwnedBy($viewer)))
            ->sortBy([['sort', 'asc'], ['id', 'asc']])
            ->values()
            ->toBase();
    }

    private function coverFor(?User $viewer): ?Media
    {
        $cover = $this->resource->cover;

        return $cover !== null && app(VehiclePresenter::class)->photoVisibleTo($cover, $this->resource->isOwnedBy($viewer)) ? $cover : $this->photosFor($viewer)->first();
    }
}
