<?php

namespace App\Http\Controllers\Admin\Team\Requests;

use App\Models\Staff;
use Illuminate\Foundation\Http\FormRequest;
use Illuminate\Validation\Rule;

/** ADM-39/40 "Einladung erneut senden" (`staff.invite`): only the mail language. */
class ResendInviteRequest extends FormRequest
{
    public function authorize(): bool
    {
        $staff = $this->user('staff');

        return $staff instanceof Staff && $staff->can('staff.invite');
    }

    /**
     * @return array<string, mixed>
     */
    public function rules(): array
    {
        return ['locale' => ['nullable', Rule::in(config('speedclub.locales'))]];
    }

    public function staff(): Staff
    {
        /** @var Staff $staff */
        $staff = $this->user('staff');

        return $staff;
    }
}
