<?php

namespace App\Http\Controllers\Admin\Team\Requests;

use App\Models\Staff;
use Illuminate\Foundation\Http\FormRequest;

/** ADM-42 matrix (`roles.manage`): role name => its full atom list, for the roles that change; a reason when four-eyes. */
class PermissionMatrixRequest extends FormRequest
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
            'matrix' => ['required', 'array', 'min:1', 'max:50'],
            'matrix.*' => ['present', 'array', 'max:100'],
            'matrix.*.*' => ['string', 'max:60'],
            'reason' => ['nullable', 'string', 'min:10', 'max:1000'],
        ];
    }

    /**
     * @return array<string, mixed>
     */
    public function matrix(): array
    {
        /** @var array<string, mixed> $matrix */
        $matrix = $this->array('matrix');

        return $matrix;
    }

    public function staff(): Staff
    {
        /** @var Staff $staff */
        $staff = $this->user('staff');

        return $staff;
    }
}
