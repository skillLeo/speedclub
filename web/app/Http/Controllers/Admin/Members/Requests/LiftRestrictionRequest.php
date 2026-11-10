<?php

namespace App\Http\Controllers\Admin\Members\Requests;

use App\Enums\DecisionRestriction;
use App\Http\Controllers\Admin\Support\ReasonRequest;
use Illuminate\Validation\Rule;

/** ADM-10 "Aufheben": the restriction type, what the member reads (facts) and a reason. A suspension also needs members.suspend (LiftRestriction). */
class LiftRestrictionRequest extends ReasonRequest
{
    protected function atom(): string
    {
        return 'members.restrict';
    }

    /**
     * @return array<string, mixed>
     */
    protected function extraRules(): array
    {
        return ['type' => ['required', Rule::enum(DecisionRestriction::class)], 'facts' => ['required', 'string', 'min:10', 'max:5000']];
    }
}
