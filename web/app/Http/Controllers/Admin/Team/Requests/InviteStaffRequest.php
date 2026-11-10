<?php

namespace App\Http\Controllers\Admin\Team\Requests;

use App\Models\Staff;
use Illuminate\Foundation\Http\FormRequest;
use Illuminate\Validation\Rule;

/** ADM-39 "Einladen" (`staff.invite`): name, address, roles, mail language; a reason (10–1000) when a role waits for four-eyes. */
class InviteStaffRequest extends FormRequest
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
        return [
            'name' => ['required', 'string', 'min:2', 'max:120'],
            'email' => ['required', 'string', 'max:191'],
            'roles' => ['required', 'array', 'min:1', 'max:20'],
            'roles.*' => ['string', 'max:60'],
            'locale' => ['required', Rule::in(config('speedclub.locales'))],
            'reason' => ['nullable', 'string', 'min:10', 'max:1000'],
        ];
    }

    public function staff(): Staff
    {
        /** @var Staff $staff */
        $staff = $this->user('staff');

        return $staff;
    }
}
