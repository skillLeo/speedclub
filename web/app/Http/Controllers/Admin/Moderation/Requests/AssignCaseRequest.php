<?php

namespace App\Http\Controllers\Admin\Moderation\Requests;

use App\Models\Staff;
use Illuminate\Foundation\Http\FormRequest;

/** ADM-20/21 "Übernehmen" (no staff_id) or reassign to a colleague (staff_id); both need moderation.decide. */
class AssignCaseRequest extends FormRequest
{
    public function authorize(): bool
    {
        $staff = $this->user('staff');

        return $staff instanceof Staff && $staff->can('moderation.decide');
    }

    /**
     * @return array<string, mixed>
     */
    public function rules(): array
    {
        return ['staff_id' => ['nullable', 'integer']];
    }
}
