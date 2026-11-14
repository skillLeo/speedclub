<?php

namespace App\Http\Resources\V1;

use App\Models\Media;
use App\Models\Product;
use App\Models\Vehicle;
use App\Services\Garage\VehiclePresenter;
use Illuminate\Http\Request;
use Illuminate\Http\Resources\Json\JsonResource;

/**
 * A build photo of the photo-led catalogue (ADR-457, DQ-1138): the lead module of the Teile scope and BRD-01, and a card of the
 * "Beliebt in Builds" rail. The photo is the build's cover as a guest sees it; `vehicle.is_sample` asks for the "Beispiel" badge.
 *
 * @property array{vehicle: Vehicle, photo: Media, product: Product|null} $resource
 */
class BuildPhotoResource extends JsonResource
{
    /**
     * @return array<string, mixed>
     */
    public function toArray(Request $request): array
    {
        $vehicle = $this->resource['vehicle'];
        $product = $this->resource['product'];
        $presenter = app(VehiclePresenter::class);

        return [
            'photo' => new MediaResource($this->resource['photo']),
            /**
             * The build behind the photo; `path` opens VEH-01 ("/v/{slug}").
             *
             * @var array{id: string, public_id: string, slug: string, title: string, full_title: string, is_sample: bool, path: string}
             */
            'vehicle' => [
                'id' => (string) $vehicle->id,
                'public_id' => (string) $vehicle->public_id,
                'slug' => (string) $vehicle->slug,
                'title' => $presenter->title($vehicle),
                'full_title' => $presenter->fullTitle($vehicle),
                'is_sample' => $vehicle->getAttribute('is_sample') === true || $vehicle->owner?->getAttribute('is_sample') === true,
                'path' => '/v/'.$vehicle->canonicalSlug(),
            ],
            /**
             * The catalogue product this build carries (BRD-02), or null.
             *
             * @var array{id: string, name: string, full_name: string, brand: array{slug: string, name: string}}|null
             */
            'product' => $product instanceof Product ? [
                'id' => $product->id,
                'name' => $product->name,
                'full_name' => $product->fullName(),
                'brand' => ['slug' => $product->brand->slug, 'name' => $product->brand->name],
            ] : null,
        ];
    }
}
