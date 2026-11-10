<?php

namespace App\Http\Controllers\Admin\Team\Requests;

use App\Models\Staff;
use Illuminate\Foundation\Http\FormRequest;

/** ADM-41 create or edit a role (`roles.manage`): name, description, atoms; a reason (10–1000) when the atoms wait for four-eyes. */
class RoleRequest extends FormRequest
{
    public function authorize(): bool
    {
        $staff = $this->user('staff');

        return $staff instanceof Staff && $staff->can('roles.manage');
    }

    /**
     * @return array<string, mixed>
     */
    public function rules(): array
    {
        return [
            'name' => ['required', 'string', 'min:3', 'max:60'],
            'description' => ['nullable', 'string', 'max:500'],
            'atoms' => ['present', 'array', 'max:100'],
            'atoms.*' => ['string', 'max:60'],
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
