<?php

namespace App\Http\Resources\V1;

use App\Enums\ReportStatus;
use App\Models\Report;
use Illuminate\Http\Request;
use Illuminate\Http\Resources\Json\JsonResource;

/**
 * The answer to POST reports: the report's id and its status, received on arrival.
 *
 * @property Report $resource
 */
class ReportReceiptResource extends JsonResource
{
    /**
     * @return array<string, mixed>
     */
    public function toArray(Request $request): array
    {
        return [
            'id' => $this->resource->id,
            /** @var ReportStatus */
            'status' => ReportStatus::Received,
        ];
    }
}
