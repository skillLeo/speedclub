<?php

namespace App\Http\Controllers\Admin\Support\Tickets\Requests;

use App\Models\Staff;
use Illuminate\Foundation\Http\FormRequest;
use Illuminate\Validation\Rule;

/** ADM-27 macro editor (`support.macros`). */
class SupportMacroRequest extends FormRequest
{
    public function authorize(): bool
    {
        $staff = $this->user('staff');

        return $staff instanceof Staff && $staff->can('support.macros');
    }

    /**
     * @return array<string, mixed>
     */
    public function rules(): array
    {
        return [
            'key' => ['required', 'string', 'max:60', 'regex:/\A[a-z0-9_]+\z/'],
            'locale' => ['required', Rule::in(['de', 'en'])],
            'title' => ['required', 'string', 'min:3', 'max:120'],
            'body' => ['required', 'string', 'min:10', 'max:5000'],
            'sort' => ['nullable', 'integer', 'min:0', 'max:999'],
        ];
    }

    /**
     * @return array{key: string, locale: string, title: string, body: string, sort: int}
     */
    public function payload(): array
    {
        return [
            'key' => $this->string('key')->value(),
            'locale' => $this->string('locale')->value(),
            'title' => trim($this->string('title')->value()),
            'body' => trim($this->string('body')->value()),
            'sort' => $this->integer('sort'),
        ];
    }
}
