<?php

namespace App\Http\Controllers\Admin\Badges\Requests;

use App\Models\Staff;
use Illuminate\Foundation\Http\FormRequest;

/**
 * ADM-63 preview "würde heute N Mitglieder erhalten" (GET, JSON): content.view. The rule comes as query parameters
 * (`metric`, `gte`, `eq`, `set`); numbers and yes become their JSON types, so PreviewBadgeRule validates exactly what SaveBadge would.
 */
class PreviewBadgeRequest extends FormRequest
{
    public function authorize(): bool
    {
        $staff = $this->user('staff');

        return $staff instanceof Staff && $staff->can('content.view');
    }

    /**
     * @return array<string, mixed>
     */
    public function rules(): array
    {
        return [
            'metric' => ['required', 'string', 'max:64'],
            'gte' => ['nullable', 'string', 'max:7'],
            'eq' => ['nullable', 'string', 'in:true'],
            'set' => ['nullable', 'string', 'max:64'],
        ];
    }

    public function staff(): Staff
    {
        /** @var Staff $staff */
        $staff = $this->user('staff');

        return $staff;
    }

    /**
     * @return array<string, mixed>
     */
    public function rule(): array
    {
        $gte = $this->query('gte');

        return array_filter([
            'metric' => $this->query('metric'),
            'gte' => is_string($gte) && ctype_digit($gte) ? (int) $gte : $gte,
            'eq' => $this->query('eq') === 'true' ? true : null,
            'set' => $this->query('set'),
        ], fn (mixed $value): bool => $value !== null && $value !== '');
    }
}
