<?php

namespace App\Http\Resources\V1;

use App\Enums\BuildUpdateType;
use App\Models\BuildUpdate;
use App\Models\Media;
use App\Models\Vehicle;
use App\Services\Garage\BuildUpdatePresenter;
use App\Services\Social\ViewerStates;
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
     * M4.8: every row registers its update and its build for the batched reader states (ViewerStates).
     */
    public function __construct($resource)
    {
        parent::__construct($resource);

        if ($resource instanceof BuildUpdate) {
            ViewerStates::register('build_update', (string) $resource->getKey());
            ViewerStates::register('vehicle', (string) $resource->getAttribute('vehicle_id'));
        }
    }

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
            /**
             * What changed (BuildUpdateType): the app picks the row's glyph and the note/post layout by it (DQ-1093).
             *
             * @var BuildUpdateType
             */
            'type' => $update->type,
            /** "Fahrwerk geändert", "Räder hinzugefügt", "Technik aktualisiert", "Fotos hinzugefügt", "Notiz" (DQ-290) */
            'type_label' => $presenter->typeLabel($update, $locale),
            /** One line: at most two changes, then "3 weitere". */
            'summary' => $presenter->summary($update, $changes, $locale),
            /** @var string|null */
            'created_at' => $created instanceof CarbonInterface ? $created->toIso8601String() : null,
            /**
             * M4.8: the update's own photos (ready, not rejected), in their order, with ThumbHash/blurhash placeholders.
             *
             * @var list<MediaResource>
             */
            'media' => $this->photos($update),
            /**
             * M4.8: the reader's own state on this update (saved in a collection, their private reaction); null for guests.
             *
             * @var array{saved: bool, reaction: string|null}|null
             */
            'viewer' => ($viewer = Viewer::from($request)) === null ? null : app(ViewerStates::class)->of($viewer, 'build_update', (string) $update->getKey()),
        ];
    }

    /**
     * @return list<MediaResource>
     */
    private function photos(BuildUpdate $update): array
    {
        $media = $update->relationLoaded('photos') ? $update->getRelation('photos') : $update->photos()->get();

        return array_values($media->filter(fn (Media $photo): bool => $photo->isUsablePhoto())
            ->sortBy([['sort', 'asc'], ['id', 'asc']])
            ->map(fn (Media $photo): MediaResource => new MediaResource($photo))
            ->all());
    }
}
