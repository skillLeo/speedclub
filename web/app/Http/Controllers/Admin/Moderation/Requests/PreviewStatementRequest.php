<?php

namespace App\Http\Controllers\Admin\Moderation\Requests;

use App\Enums\DecisionAction;
use App\Enums\RestrictionType;
use App\Models\Staff;
use Illuminate\Foundation\Http\FormRequest;
use Illuminate\Validation\Rule;

/** ADM-21 "Vorschau": what the member would read, DE/EN; nothing is stored, no reason needed. */
class PreviewStatementRequest extends FormRequest
{
    public function authorize(): bool
    {
        $staff = $this->user('staff');

        return $staff instanceof Staff && $staff->can('moderation.decide');
    }

    /**
     * @return array<string, mixed>
     */
    public function rules(): array
    {
        return [
            'action' => ['required', Rule::in([DecisionAction::NoAction->value, DecisionAction::RemoveContent->value, DecisionAction::Restrict->value, DecisionAction::Suspend->value])],
            'restriction' => ['nullable', Rule::enum(RestrictionType::class)],
            'until' => ['nullable', 'date'],
            'facts' => ['nullable', 'string', 'max:5000'],
            'ground' => ['nullable', 'string', 'max:2000'],
        ];
    }
}
