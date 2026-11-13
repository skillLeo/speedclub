<?php

namespace App\Http\Resources\V1;

use App\Models\Media;
use App\Models\Modification;
use App\Models\User;
use App\Services\Discover\WheelSetup;
use App\Services\Garage\VehiclePresenter;
use App\Support\Viewer;
use Illuminate\Http\Request;
use Illuminate\Http\Resources\Json\JsonResource;

/**
 * A row of the DISC-04 wheel-setup table. Numbers as stored (inches, J, ET, mm); the app formats them per 02_PRODUCT_SPEC §3.9
 * ("19″ × 9,5J ET35", "255/35 R19", "−35 mm"). A rear value is null when the owner entered only the front (a square set; the rear
 * diameter is only stored when it differs, ADR-112).
 *
 * @property WheelSetup $resource
 */
class WheelSetupResource extends JsonResource
{
    /**
     * @return array<string, mixed>
     */
    public function toArray(Request $request): array
    {
        $setup = $this->resource;
        $vehicle = $setup->vehicle;
        $viewer = Viewer::from($request);
        $presenter = app(VehiclePresenter::class);
        $cover = $presenter->cover($vehicle, $vehicle->isOwnedBy($viewer));
        $owner = $vehicle->owner;
        $wheel = $this->fields($setup->wheels);

        return [
            /**
             * Tap opens VEH-01 (`public/vehicles/{slug}`). `owner` is null when the owner hides the name (ADR-148 a).
             *
             * @var array{id: string, slug: string, full_title: string, cover: MediaResource|null, is_sample: bool, owner: MemberSummaryResource|null}
             */
            'vehicle' => [
                'id' => $vehicle->id,
                'slug' => $vehicle->slug,
                'full_title' => $presenter->fullTitle($vehicle),
                'cover' => $cover instanceof Media ? new MediaResource($cover) : null,
                'is_sample' => $vehicle->getAttribute('is_sample') === true,
                'owner' => $owner instanceof User && ($vehicle->isOwnedBy($viewer) || $owner->getAttribute('show_owner_on_qr') !== false)
                    ? new MemberSummaryResource($owner)
                    : null,
            ],
            /**
             * @var array{brand: string|null, model: string|null, diameter_front: float|null, diameter_rear: float|null, width_front: float|null, width_rear: float|null, et_front: float|null, et_rear: float|null, tyre_front: string|null, tyre_rear: string|null, spacers_front: float|null, spacers_rear: float|null}
             */
            'wheel' => [
                'brand' => $this->brand($setup->wheels),
                'model' => $this->text($wheel['wheel_model'] ?? null),
                'diameter_front' => $this->number($wheel['diameter'] ?? null),
                'diameter_rear' => $this->number($wheel['diameter_rear'] ?? null),
                'width_front' => $this->number($wheel['width_front'] ?? null),
                'width_rear' => $this->number($wheel['width_rear'] ?? null),
                'et_front' => $this->number($wheel['et_front'] ?? null),
                'et_rear' => $this->number($wheel['et_rear'] ?? null),
                'tyre_front' => $this->text($wheel['tyre_size_front'] ?? null),
                'tyre_rear' => $this->text($wheel['tyre_size_rear'] ?? null),
                'spacers_front' => $this->number($wheel['spacer_front'] ?? null),
                'spacers_rear' => $this->number($wheel['spacer_rear'] ?? null),
            ],
            /**
             * The first installed suspension mod; null when the build has none. `type` is the option value ("coilover"), `type_label`
             * its name in the request's language; lowering in mm down.
             *
             * @var array{type: string|null, type_label: string|null, brand: string|null, model: string|null, lowering_front: float|null, lowering_rear: float|null}|null
             */
            'suspension' => $setup->suspension === null ? null : $this->suspension($setup->suspension),
        ];
    }

    /**
     * @return array{type: string|null, type_label: string|null, brand: string|null, model: string|null, lowering_front: float|null, lowering_rear: float|null}
     */
    private function suspension(Modification $mod): array
    {
        $fields = $this->fields($mod);
        $type = $this->text($fields['type'] ?? null);
        $label = null;

        foreach ($mod->category->fields ?? [] as $field) {
            if ($field->getAttribute('key') === 'type') {
                foreach ((array) ($field->getAttribute('options') ?? []) as $option) {
                    if (is_array($option) && ($option['value'] ?? null) === $type) {
                        $label = $option['label'][app()->getLocale()] ?? $option['label']['de'] ?? null;
                    }
                }
            }
        }

        return [
            'type' => $type,
            'type_label' => is_string($label) ? $label : null,
            'brand' => $this->brand($mod),
            'model' => $this->text($fields['model'] ?? null) ?? $this->text($mod->getAttribute('part_name')),
            'lowering_front' => $this->number($fields['lowering_front'] ?? null),
            'lowering_rear' => $this->number($fields['lowering_rear'] ?? null),
        ];
    }

    /**
     * @return array<string, mixed>
     */
    private function fields(Modification $mod): array
    {
        /** @var array<string, mixed> $fields */
        $fields = $mod->getAttribute('fields') ?? [];

        return $fields;
    }

    private function brand(Modification $mod): ?string
    {
        return $this->text($mod->brand?->getAttribute('name') ?? $mod->getAttribute('brand_text'));
    }

    private function number(mixed $value): ?float
    {
        return is_numeric($value) ? (float) $value : null;
    }

    private function text(mixed $value): ?string
    {
        return is_string($value) && trim($value) !== '' ? trim($value) : null;
    }
}
