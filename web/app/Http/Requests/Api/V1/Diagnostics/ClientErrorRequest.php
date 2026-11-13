<?php

namespace App\Http\Requests\Api\V1\Diagnostics;

use Illuminate\Foundation\Http\FormRequest;

/**
 * One crash report of the app's error screen. Bounded strings only: the message and stacks come from the app's own code, never from
 * a form, and are cut to their limits before they are logged.
 */
class ClientErrorRequest extends FormRequest
{
    public function authorize(): bool
    {
        return true;
    }

    /**
     * @return array<string, list<string>>
     */
    public function rules(): array
    {
        return [
            'route' => ['required', 'string', 'max:200'],
            'name' => ['nullable', 'string', 'max:100'],
            'message' => ['required', 'string', 'max:2000'],
            'stack' => ['nullable', 'string', 'max:8000'],
            'component_stack' => ['nullable', 'string', 'max:8000'],
            'platform' => ['required', 'string', 'in:web,ios,android'],
            'app_version' => ['nullable', 'string', 'max:40'],
            'locale' => ['nullable', 'string', 'max:10'],
            'font_scale' => ['nullable', 'numeric', 'between:0.5,4'],
            'viewport' => ['nullable', 'string', 'regex:/\A\d{2,5}x\d{2,5}(@[\d.]{1,5})?\z/'],
            'user_agent' => ['nullable', 'string', 'max:300'],
        ];
    }
}
