<?php

namespace App\Http\Controllers\Admin\Spots\Requests;

use App\Actions\Admin\Moderation\RemoveSpots;
use App\Http\Controllers\Admin\Support\ReasonRequest;

/**
 * ADM-62 bulk "Spots entfernen" (a burst): moderation.decide, a reason for every spot, 1–50 spot ids.
 */
class BulkRemoveSpotsRequest extends ReasonRequest
{
    protected function atom(): string
    {
        return 'moderation.decide';
    }

    /**
     * @return array<string, mixed>
     */
    protected function extraRules(): array
    {
        return [
            'ids' => ['required', 'array', 'min:1', 'max:'.RemoveSpots::MAX_BULK],
            'ids.*' => ['required', 'string', 'size:26'],
        ];
    }

    /**
     * @return array<mixed>
     */
    public function ids(): array
    {
        return (array) $this->validated('ids');
    }
}
