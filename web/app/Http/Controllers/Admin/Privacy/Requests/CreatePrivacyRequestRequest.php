<?php

namespace App\Http\Controllers\Admin\Privacy\Requests;

use App\Enums\PrivacyRequestSource;
use App\Enums\PrivacyRequestType;
use App\Models\Staff;
use Illuminate\Foundation\Http\FormRequest;
use Illuminate\Validation\Rule;

/**
 * ADM-45 "Anfrage erfassen" (`privacy.process`): type, source, a member (@username) or an external requester (name, address), language,
 * the request text and when it arrived. CreatePrivacyRequest validates the rest.
 */
class CreatePrivacyRequestRequest extends FormRequest
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
            'type' => ['required', Rule::enum(PrivacyRequestType::class)],
            'source' => ['required', Rule::enum(PrivacyRequestSource::class)],
            'member' => ['nullable', 'string', 'max:40'],
            'requester_name' => ['nullable', 'string', 'max:160'],
            'requester_email' => ['nullable', 'string', 'max:191'],
            'locale' => ['nullable', Rule::in(config('speedclub.locales'))],
            'details' => ['nullable', 'string', 'max:5000'],
            'received_at' => ['nullable', 'date'],
        ];
    }

    public function staff(): Staff
    {
        /** @var Staff $staff */
        $staff = $this->user('staff');

        return $staff;
    }
}
