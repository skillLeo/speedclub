<?php

namespace App\Http\Resources\V1;

use Illuminate\Http\Request;
use Illuminate\Http\Resources\Json\JsonResource;

/**
 * @property array{required: list<array{key: string, version: string, summary: string|null, published_at: string|null}>, accepted: array{terms: string|null, privacy: string|null}, consented_at: string|null} $resource
 */
class ConsentStateResource extends JsonResource
{
    /**
     * @return array<string, mixed>
     */
    public function toArray(Request $request): array
    {
        return [
            /**
             * Documents the member must accept again before using the app: show the re-consent sheet with the summary and links to
             * SET-17/18; accept with POST me/consents, decline signs out. Empty when nothing is due.
             *
             * @var list<array{key: 'terms'|'privacy', version: string, summary: string|null, published_at: string|null}>
             */
            'required' => $this->resource['required'],
            /** @var array{terms: string|null, privacy: string|null} */
            'accepted' => $this->resource['accepted'],
            /** @var string|null */
            'consented_at' => $this->resource['consented_at'],
        ];
    }
}
