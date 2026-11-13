<?php

namespace App\Http\Requests\Api\V1\Maintenance;

use Illuminate\Foundation\Http\FormRequest;

/**
 * A photo of a service log entry (receipt, booklet stamp): JPEG, PNG or WebP through the media pipeline, kept on the private disk.
 */
class MaintenancePhotoRequest extends FormRequest
{
    /**
     * @return array<string, mixed>
     */
    public function rules(): array
    {
        return [
            'file' => ['required', 'file'],
        ];
    }
}
