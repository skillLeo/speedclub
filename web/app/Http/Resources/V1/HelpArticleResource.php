<?php

namespace App\Http\Resources\V1;

use App\Models\HelpArticle;
use Illuminate\Http\Request;
use Illuminate\Http\Resources\Json\JsonResource;

/**
 * SET-14 reader. The body is Markdown for the legal-viewer component.
 *
 * @property HelpArticle $resource
 */
class HelpArticleResource extends JsonResource
{
    /**
     * @return array{key: string, title: string, locale: string, body_md: string, updated_at: string|null}
     */
    public function toArray(Request $request): array
    {
        return [
            'key' => $this->resource->key,
            'title' => $this->resource->title,
            'locale' => $this->resource->locale,
            'body_md' => $this->resource->body_md,
            'updated_at' => $this->resource->updated_at?->toIso8601String(),
        ];
    }
}
