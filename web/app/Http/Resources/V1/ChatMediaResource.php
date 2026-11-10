<?php

namespace App\Http\Resources\V1;

use App\Http\Resources\Concerns\AnswersDelivery;
use App\Models\Media;
use App\Models\User;
use App\Services\Messaging\ChatMedia;
use Illuminate\Http\Request;
use Illuminate\Http\Resources\Json\JsonResource;

/**
 * A chat photo (M2.4 review #5): the fields of MediaResource, with variant URLs signed for the reader, valid 10–20 minutes. The files
 * are on the private disk; a URL works only while the reader still sees the photo.
 *
 * @property Media $resource
 */
class ChatMediaResource extends JsonResource
{
    use AnswersDelivery;

    /**
     * @return array<string, mixed>
     */
    public function toArray(Request $request): array
    {
        $media = $this->resource;
        $viewer = $request->user();

        return [
            'id' => $media->id,
            'status' => $media->status,
            'category' => $media->category,
            /** @var int|null */
            'width' => $media->getAttribute('width'),
            /** @var int|null */
            'height' => $media->getAttribute('height'),
            /** @var string|null */
            'blurhash' => $media->getAttribute('blurhash'),
            /**
             * Signed for you, valid 10–20 minutes; read the message again for fresh ones.
             *
             * @var list<array{width: int, height: int, url: string}>
             */
            'variants' => $viewer instanceof User ? app(ChatMedia::class)->variants($media, $viewer) : [],
            'created_at' => $media->created_at?->toIso8601String(),
        ];
    }
}
