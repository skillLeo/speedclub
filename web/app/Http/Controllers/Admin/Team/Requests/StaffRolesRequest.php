<?php

namespace App\Http\Controllers\Admin\Team\Requests;

use App\Models\Staff;
use Illuminate\Foundation\Http\FormRequest;

/** ADM-40 role set (`staff.manage`): the full new set (may be empty); a reason (10–1000) is required by the Action when it is four-eyes. */
class StaffRolesRequest extends FormRequest
{
    public function authorize(): bool
    {
        $staff = $this->user('staff');

        return $staff instanceof Staff && $staff->can('staff.manage');
    }

    /**
     * @return array<string, mixed>
     */
    public function rules(): array
    {
        return [
            'roles' => ['present', 'array', 'max:20'],
            'roles.*' => ['string', 'max:60'],
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
