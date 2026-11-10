<?php

namespace App\Http\Controllers\Admin\Vehicles\Requests;

use App\Http\Controllers\Admin\Support\ReasonRequest;
use App\Services\Admin\Members\BulkRunner;
use App\Services\Moderation\Statement;

/** ADM-11 bulk hide (recent password): ids (at most 500; more than 100 → approval), one statement of reasons, a reason. */
class BulkHideVehiclesRequest extends ReasonRequest
{
    protected function atom(): string
    {
        return 'vehicles.hide';
    }

    /**
     * @return array<string, mixed>
     */
    protected function extraRules(): array
    {
        return [
            'ids' => ['required', 'array', 'min:1', 'max:'.BulkRunner::MAX_IDS],
            'ids.*' => ['required', 'string', 'ulid'],
            ...Statement::rules(),
        ];
    }
}
