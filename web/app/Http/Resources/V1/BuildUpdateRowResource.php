<?php

namespace App\Http\Resources\V1;

use App\Models\BuildUpdate;
use App\Models\Vehicle;
use App\Services\Garage\BuildUpdatePresenter;
use App\Support\Viewer;
use Carbon\CarbonInterface;
use Illuminate\Http\Request;
use Illuminate\Http\Resources\Json\JsonResource;

/**
 * A "Build-Updates" row of HOME-01 (FS-2) and an update item of GET feed: the build's card and the change in one line, as on the card
 * ("Fahrwerk: Serie → KW V3 · −35 mm", then "3 weitere"). Load the vehicle with FeedVehicleResource::RELATIONS.
 *
 * @property BuildUpdate $resource
 */
class BuildUpdateRowResource extends JsonResource
{
    private const CHANGES = 2;

    /**
     * @return array<string, mixed>
     */
    public function toArray(Request $request): array
    {
        $update = $this->resource;
        $locale = app()->getLocale();
        $presenter = app(BuildUpdatePresenter::class);
        $changes = $presenter->changes($update, Viewer::powerDisplay(Viewer::from($request)), $locale, self::CHANGES);
        $created = $update->getAttribute('created_at');
        /** @var Vehicle $vehicle */
        $vehicle = $update->vehicle;

        return [
            'id' => (string) $update->getKey(),
            'vehicle' => new FeedVehicleResource($vehicle),
            /** "Fahrwerk geändert", "Räder hinzugefügt", "Technik aktualisiert", "Fotos hinzugefügt", "Notiz" (DQ-290) */
            'type_label' => $presenter->typeLabel($update, $locale),
            /** One line: at most two changes, then "3 weitere". */
            'summary' => $presenter->summary($update, $changes, $locale),
            /** @var string|null */
            'created_at' => $created instanceof CarbonInterface ? $created->toIso8601String() : null,
        ];
    }
}
