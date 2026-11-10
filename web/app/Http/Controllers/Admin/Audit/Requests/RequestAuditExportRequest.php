<?php

namespace App\Http\Controllers\Admin\Audit\Requests;

use App\Models\Staff;
use Illuminate\Foundation\Http\FormRequest;

class RequestAuditExportRequest extends FormRequest
{
    public function authorize(): bool
    {
        $staff = $this->user('staff');

        return $staff instanceof Staff && $staff->can('audit.export');
    }

    /**
     * @return array<string, mixed>
     */
    public function rules(): array
    {
        return [
            'format' => ['required', 'string', 'in:csv,jsonl'],
            'reason' => ['required', 'string', 'min:10', 'max:1000'],
            'filter' => ['sometimes', 'array:actor,action,target_type,target_id,from,to'],
            'filter.*' => ['nullable', 'string', 'max:200'],
            'filter.from' => ['nullable', 'date_format:Y-m-d'],
            'filter.to' => ['nullable', 'date_format:Y-m-d', 'after_or_equal:filter.from'],
        ];
    }
}
