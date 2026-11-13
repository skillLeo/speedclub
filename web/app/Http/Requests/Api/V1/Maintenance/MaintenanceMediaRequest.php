<?php

namespace App\Http\Requests\Api\V1\Maintenance;

use App\Http\Requests\Api\V1\Messaging\MessagingRules;
use Illuminate\Foundation\Http\FormRequest;

/**
 * GET maintenance-media/{media}/{width}: the signed URL of a service log photo. The signature covers `viewer`.
 */
class MaintenanceMediaRequest extends FormRequest
{
    /**
     * @return array<string, mixed>
     */
    public function rules(): array
    {
        return [
            'viewer' => ['required', 'string', MessagingRules::ULID],
        ];
    }

    public function viewerId(): string
    {
        return strtolower((string) $this->validated('viewer'));
    }
}
