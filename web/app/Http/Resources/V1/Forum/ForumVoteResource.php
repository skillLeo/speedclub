<?php

namespace App\Http\Resources\V1\Forum;

use App\Models\ForumPost;
use Illuminate\Http\Request;
use Illuminate\Http\Resources\Json\JsonResource;

/**
 * The "Hilfreich" state of a reply after a vote or its withdrawal.
 *
 * @property array{post: ForumPost, voted: bool} $resource
 */
class ForumVoteResource extends JsonResource
{
    /**
     * @return array<string, mixed>
     */
    public function toArray(Request $request): array
    {
        return [
            /** @var string */
            'post_id' => $this->resource['post']->id,
            /**
             * Shown in the forum only (ADR-506).
             *
             * @var int
             */
            'helpful_count' => $this->resource['post']->helpful_count,
            /** @var bool */
            'voted' => $this->resource['voted'],
        ];
    }
}
