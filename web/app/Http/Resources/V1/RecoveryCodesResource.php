<?php

namespace App\Http\Resources\V1;

use Illuminate\Http\Request;
use Illuminate\Http\Resources\Json\JsonResource;

/**
 * SET-05: the ten recovery codes ("ABCDE-FGHJK"), shown this once; the server keeps only their hashes. Cache-Control: no-store.
 *
 * @property list<string> $resource
 */
class RecoveryCodesResource extends JsonResource
{
    use NoStore;

    /**
     * @return array{recovery_codes: list<string>}
     */
    public function toArray(Request $request): array
    {
        return [
            /** @var list<string> Ten codes, "ABCDE-FGHJK". */
            'recovery_codes' => $this->resource,
        ];
    }
}
