<?php

namespace App\Http\Resources\V1;

use App\Models\HelpArticle;
use Illuminate\Http\Request;
use Illuminate\Http\Resources\Json\JsonResource;

/**
 * SET-14 list row.
 *
 * @property HelpArticle $resource
 */
class HelpArticleSummaryResource extends JsonResource
{
    /**
     * @return array{key: string, title: string, locale: string}
     */
    public function toArray(Request $request): array
    {
        return [
            'key' => $this->resource->key,
            'title' => $this->resource->title,
            // The language of the text: de when the requested language has no own version.
            'locale' => $this->resource->locale,
        ];
    }
}
