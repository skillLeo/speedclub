<?php

namespace App\Http\Controllers\Admin\Moderation\Requests;

use App\Enums\DecisionAction;
use App\Enums\GroundDocument;
use App\Models\Staff;
use Illuminate\Foundation\Http\FormRequest;
use Illuminate\Validation\Rule;

/** ADM-24 template editor (`moderation.templates`). */
class SorTemplateRequest extends FormRequest
{
    public function authorize(): bool
    {
        $staff = $this->user('staff');

        return $staff instanceof Staff && $staff->can('moderation.templates');
    }

    /**
     * @return array<string, mixed>
     */
    public function rules(): array
    {
        return [
            'key' => ['required', 'string', 'max:60', 'regex:/\A[a-z0-9_]+\z/'],
            'locale' => ['required', Rule::in(['de', 'en'])],
            'action' => ['required', Rule::in([DecisionAction::RemoveContent->value, DecisionAction::Restrict->value, DecisionAction::Suspend->value, DecisionAction::NoAction->value])],
            'label' => ['required', 'string', 'min:3', 'max:120'],
            'facts' => ['required', 'string', 'min:10', 'max:5000'],
            'ground' => ['required', 'string', 'min:3', 'max:2000'],
            'ground_document' => ['required', Rule::enum(GroundDocument::class)],
            'ground_section' => ['nullable', 'string', 'max:100'],
            'sort' => ['nullable', 'integer', 'min:0', 'max:999'],
        ];
    }

    /**
     * @return array{key: string, locale: string, action: DecisionAction, label: string, facts: string, ground: string, ground_document: GroundDocument, ground_section: string|null, sort: int}
     */
    public function payload(): array
    {
        $section = trim($this->string('ground_section')->value());

        return [
            'key' => $this->string('key')->value(),
            'locale' => $this->string('locale')->value(),
            'action' => DecisionAction::from($this->string('action')->value()),
            'label' => trim($this->string('label')->value()),
            'facts' => trim($this->string('facts')->value()),
            'ground' => trim($this->string('ground')->value()),
            'ground_document' => GroundDocument::from($this->string('ground_document')->value()),
            'ground_section' => $section === '' ? null : $section,
            'sort' => $this->integer('sort'),
        ];
    }
}
