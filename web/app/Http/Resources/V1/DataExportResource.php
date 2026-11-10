<?php

namespace App\Http\Resources\V1;

use App\Enums\DataExportStatus;
use App\Models\DataExport;
use App\Services\DataExport\BuildDataExport;
use Illuminate\Http\JsonResponse;
use Illuminate\Http\Request;
use Illuminate\Http\Resources\Json\JsonResource;

/**
 * SET-12 status row.
 *
 * @property DataExport $resource
 */
class DataExportResource extends JsonResource
{
    private int $status = 200;

    /**
     * 202 for the answer to POST me/export: the jobs still have to run.
     */
    public function accepted(): self
    {
        $this->status = 202;

        return $this;
    }

    /**
     * @param  Request  $request
     * @param  JsonResponse  $response
     */
    public function withResponse($request, $response): void
    {
        $response->setStatusCode($this->status);
        // download_url is a signed credential for 7 days: no cache may keep it (review should-fix 4).
        $response->headers->set('Cache-Control', 'no-store, private');
    }

    /**
     * @return array<string, mixed>
     */
    public function toArray(Request $request): array
    {
        $export = $this->resource;

        return [
            'id' => $export->id,
            /** @var DataExportStatus */
            'status' => $export->status === DataExportStatus::Ready && ! $export->isDownloadable() ? DataExportStatus::Expired : $export->status,
            /** ISO 8601. */
            'requested_at' => $export->requested_at?->toIso8601String(),
            /** @var string|null */
            'ready_at' => $export->ready_at?->toIso8601String(),
            /** @var string|null When the link and the file end (7 days after ready_at). */
            'expires_at' => $export->expires_at?->toIso8601String(),
            /** @var int|null Size of the ZIP in bytes, once ready. */
            'bytes' => $export->isDownloadable() ? $export->bytes : null,
            /** @var string|null The signed download link (the one the mail carries), while ready. */
            'download_url' => $export->isDownloadable() ? BuildDataExport::downloadUrl($export) : null,
        ];
    }
}
