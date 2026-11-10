<?php

namespace App\Http\Controllers\Admin\Privacy\Requests;

use App\Http\Controllers\Admin\Support\ReasonRequest;

/** ADM-47 "Speichern" (`retention.manage`, with reason): key => whole number; the bounds are RetentionSchema's. */
class RetentionRequest extends ReasonRequest
{
    protected function atom(): string
    {
        return 'retention.manage';
    }

    protected function extraRules(): array
    {
        return ['periods' => ['required', 'array', 'max:20'], 'periods.*' => ['nullable', 'integer', 'min:0', 'max:1000']];
    }
}
