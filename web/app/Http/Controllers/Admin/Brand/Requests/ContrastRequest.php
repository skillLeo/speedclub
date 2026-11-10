<?php

namespace App\Http\Controllers\Admin\Brand\Requests;

use App\Models\Staff;
use Illuminate\Foundation\Http\FormRequest;

/** ADM-28 focal point: the point (0–1) the editor clicked; the Action measures the hero there. */
class ContrastRequest extends FormRequest
{
    public function authorize(): bool
    {
        $staff = $this->user('staff');

        return $staff instanceof Staff && $staff->can('brand.manage');
    }

    /**
     * @return array<string, mixed>
     */
    public function rules(): array
    {
        return [
            'focal_x' => ['required', 'numeric', 'between:0,1'],
            'focal_y' => ['required', 'numeric', 'between:0,1'],
        ];
    }

    public function staff(): Staff
    {
        /** @var Staff $staff */
        $staff = $this->user('staff');

        return $staff;
    }
}
