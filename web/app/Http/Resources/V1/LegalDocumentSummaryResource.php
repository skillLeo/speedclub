<?php

namespace App\Http\Resources\V1;

use App\Models\LegalDocument;
use Illuminate\Http\Request;
use Illuminate\Http\Resources\Json\JsonResource;

/**
 * One row of the legal list (SET-17), without the text.
 *
 * @mixin LegalDocument
 */
class LegalDocumentSummaryResource extends JsonResource
{
    /**
     * @return array<string, mixed>
     */
    public function toArray(Request $request): array
    {
        return [
            'key' => $this->key,
            'title' => $this->key->label(),
            'locale' => $this->locale,
            'version' => $this->version,
            /** @var string */
            'published_at' => $this->published_at?->toIso8601String(),
        ];
    }
}
