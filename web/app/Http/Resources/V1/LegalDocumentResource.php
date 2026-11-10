<?php

namespace App\Http\Resources\V1;

use App\Models\LegalDocument;
use Illuminate\Http\Request;
use Illuminate\Http\Resources\Json\JsonResource;

/**
 * body_md is Markdown; the client renders it in safe mode (05_ARCHITECTURE §15).
 *
 * @mixin LegalDocument
 */
class LegalDocumentResource extends JsonResource
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
            'body_md' => $this->body_md,
            /** @var string */
            'published_at' => $this->published_at?->toIso8601String(),
        ];
    }
}
