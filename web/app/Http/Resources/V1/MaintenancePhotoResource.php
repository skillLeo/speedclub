<?php

namespace App\Http\Resources\V1;

use App\Models\Media;
use App\Models\User;
use App\Services\Maintenance\MaintenanceMedia;
use App\Support\Viewer;
use Illuminate\Http\Request;
use Illuminate\Http\Resources\Json\JsonResource;

/**
 * A photo of a service log entry: signed private URLs (MaintenanceMedia), empty variants while it is processed.
 *
 * @property Media $resource
 */
class MaintenancePhotoResource extends JsonResource
{
    /**
     * @return array<string, mixed>
     */
    public function toArray(Request $request): array
    {
        $photo = $this->resource;
        $viewer = Viewer::from($request);

        return [
            'id' => $photo->id,
            'status' => $photo->status->value,
            'width' => $photo->getAttribute('width'),
            'height' => $photo->getAttribute('height'),
            'blurhash' => $photo->getAttribute('blurhash'),
            /** @var list<array{width: int, height: int, url: string}> */
            'variants' => $viewer instanceof User && $photo->isUsablePhoto() ? app(MaintenanceMedia::class)->variants($photo, $viewer) : [],
        ];
    }
}
