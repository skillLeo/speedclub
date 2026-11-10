<?php

namespace App\Http\Controllers\Admin\Moderation\Requests;

use App\Http\Controllers\Admin\Support\ReasonRequest;
use App\Services\Admin\Members\BulkRunner;
use Illuminate\Validation\Rule;

/** ADM-20 bulk "Keine Maßnahme" (recent password, reason): up to 500 case ids. */
class BulkNoActionRequest extends ReasonRequest
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
            'action' => ['required', Rule::in(['no_action'])],
            'ids' => ['required', 'array', 'min:1', 'max:'.BulkRunner::MAX_IDS],
            'ids.*' => ['string', 'size:26'],
        ];
    }
}
