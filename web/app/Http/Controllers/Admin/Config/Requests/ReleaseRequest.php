<?php

namespace App\Http\Controllers\Admin\Config\Requests;

use App\Models\Staff;
use Illuminate\Foundation\Http\FormRequest;

/** ADM-38 manual entry or correction (`releases.manage`); RecordRelease validates the fields, a correction may carry a reason. */
class ReleaseRequest extends FormRequest
{
    public function authorize(): bool
    {
        $staff = $this->user('staff');

        return $staff instanceof Staff && $staff->can('releases.manage');
    }

    /**
     * @return array<string, mixed>
     */
    public function rules(): array
    {
        return [
            'version_name' => ['sometimes', 'string', 'max:32'],
            'version_code' => ['sometimes', 'integer'],
            'platform' => ['sometimes', 'string', 'max:20'],
            'channel' => ['sometimes', 'string', 'max:20'],
            'apk_sha256' => ['nullable', 'string', 'max:64'],
            'notes' => ['nullable', 'string', 'max:5000'],
            'released_at' => ['nullable', 'date'],
            'reason' => ['nullable', 'string', 'min:10', 'max:1000'],
        ];
    }

    /**
     * @return array<string, mixed>
     */
    public function release(): array
    {
        $data = $this->safe()->except('reason');

        foreach (['apk_sha256', 'notes', 'released_at'] as $optional) {
            if (array_key_exists($optional, $data) && is_string($data[$optional]) && trim($data[$optional]) === '') {
                $data[$optional] = null;
            }
        }

        return $data;
    }

    public function staff(): Staff
    {
        /** @var Staff $staff */
        $staff = $this->user('staff');

        return $staff;
    }

    public function reasonOrNull(): ?string
    {
        $reason = trim($this->string('reason')->value());

        return $reason === '' ? null : $reason;
    }
}
