<?php

namespace App\Http\Controllers\Admin\Privacy\Requests;

use App\Enums\PrivacyReplyTemplate;
use App\Enums\PrivacyRequestStatus;
use App\Models\Staff;
use Illuminate\Foundation\Http\FormRequest;
use Illuminate\Validation\Rule;

/**
 * ADM-46 steps (`privacy.process`): assignment and status, the extension's reason, a template reply (template, language, an added
 * paragraph), the erasure's reason, the completion (outcome, note, evidence file). Each Action checks its own rules again.
 */
class PrivacyStepRequest extends FormRequest
{
    public function authorize(): bool
    {
        $staff = $this->user('staff');

        return $staff instanceof Staff && $staff->can('privacy.process');
    }

    /**
     * @return array<string, mixed>
     */
    public function rules(): array
    {
        return [
            'assigned_to' => ['nullable', 'integer'],
            'status' => ['nullable', Rule::enum(PrivacyRequestStatus::class)],
            'template' => ['nullable', Rule::enum(PrivacyReplyTemplate::class)],
            'locale' => ['nullable', Rule::in(config('speedclub.locales'))],
            'detail' => ['nullable', 'string', 'max:2000'],
            'reason' => ['nullable', 'string', 'min:10', 'max:1000'],
            'note' => ['nullable', 'string', 'max:5000'],
            'evidence' => ['nullable', 'file'],
        ];
    }

    public function staff(): Staff
    {
        /** @var Staff $staff */
        $staff = $this->user('staff');

        return $staff;
    }
}
