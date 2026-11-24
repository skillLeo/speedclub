<?php

namespace App\Http\Resources\V1\Forum;

use App\Models\ForumThread;
use Illuminate\Http\Request;
use Illuminate\Http\Resources\Json\JsonResource;

/**
 * A short reference to a thread (notifications, "zusammengeführt mit"): its title and the app path of FOR-03.
 *
 * @property ForumThread $resource
 */
class ForumThreadRefResource extends JsonResource
{
    /**
     * @return array<string, mixed>
     */
    public function toArray(Request $request): array
    {
        return [
            'id' => $this->resource->id,
            'title' => $this->resource->title,
            /** "/forum/{id}". */
            'path' => $this->resource->path(),
            'is_sample' => $this->resource->is_sample,
        ];
    }
}
