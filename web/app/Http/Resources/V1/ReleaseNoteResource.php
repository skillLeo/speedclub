<?php

namespace App\Http\Resources\V1;

use Illuminate\Http\Request;
use Illuminate\Http\Resources\Json\JsonResource;

/**
 * One release of SET-25 "Was ist neu".
 *
 * @property array{version: string, date: string, title: string, items: list<string>} $resource
 */
class ReleaseNoteResource extends JsonResource
{
    /**
     * @return array<string, mixed>
     */
    public function toArray(Request $request): array
    {
        return [
            /** "1.0.0" */
            'version' => $this->resource['version'],
            /** YYYY-MM-DD, the day the release reached members. */
            'date' => $this->resource['date'],
            /** @var string */
            'title' => $this->resource['title'],
            /**
             * What is new, one sentence each.
             *
             * @var list<string>
             */
            'items' => $this->resource['items'],
        ];
    }
}
