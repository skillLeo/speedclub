<?php

namespace App\Http\Resources\V1;

use App\Enums\ModTagStatus;
use App\Models\ModBusinessTag;
use App\Models\Modification;
use Illuminate\Http\Request;
use Illuminate\Http\Resources\Json\JsonResource;

/**
 * A row of BIZ-04 Anfragen and of the member's confirmations: the mod (title, category) on its build, the business, who asked and the
 * state. The build is named only as the reader may see it (a build that went private shows no title).
 *
 * @property ModBusinessTag $resource
 */
class ModTagResource extends JsonResource
{
    /**
     * @return array<string, mixed>
     */
    public function toArray(Request $request): array
    {
        $tag = $this->resource;
        $mod = $tag->modification;
        $vehicle = $mod?->vehicle;

        return [
            'id' => $tag->id,
            /** @var ModTagStatus */
            'status' => $tag->status,
            /** Who asked first; the other side decides. @var \App\Enums\ModTagInitiator */
            'initiated_by' => $tag->initiated_by,
            /** @var array{id: string, title: string, category: string}|null */
            'mod' => $mod instanceof Modification ? ['id' => $mod->id, 'title' => (string) $mod->getAttribute('title'), 'category' => $mod->category->key] : null,
            'vehicle' => $vehicle !== null ? new VehicleRefResource($vehicle) : null,
            /** @var string|null */
            'owner_username' => $vehicle?->owner?->username,
            /** @var array{slug: string, name: string} */
            'business' => ['slug' => $tag->business->slug, 'name' => $tag->business->name],
            /** @var string|null */
            'decided_at' => $tag->decided_at?->toIso8601String(),
            'created_at' => $tag->created_at?->toIso8601String(),
        ];
    }
}
