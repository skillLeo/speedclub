<?php

namespace App\Http\Controllers\Admin\Content\Requests;

/**
 * ADM-33 save, preview or "Test an mich senden" (`content.edit`): the edited fields of one template and language. SaveMessageTemplate
 * refuses fixed fields and unknown variables.
 */
class TemplateFieldsRequest extends ContentRequest
{
    protected function atom(): string
    {
        return 'content.edit';
    }

    /**
     * @return array<string, mixed>
     */
    public function rules(): array
    {
        return [
            'fields' => ['sometimes', 'array', 'max:80'],
            'fields.*' => ['nullable', 'string', 'max:2000'],
        ];
    }

    /**
     * @return array<string, mixed>|null
     */
    public function fields(): ?array
    {
        $fields = $this->input('fields');

        return is_array($fields) ? $fields : null;
    }

    public function template(): string
    {
        return (string) $this->route('template');
    }

    public function locale(): string
    {
        return (string) $this->route('locale');
    }
}
