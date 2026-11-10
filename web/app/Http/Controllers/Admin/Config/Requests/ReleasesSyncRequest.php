<?php

namespace App\Http\Controllers\Admin\Config\Requests;

use App\Models\Staff;
use Illuminate\Foundation\Http\FormRequest;

/** ADM-38 "Aus RELEASES.md übernehmen" (`releases.manage`). */
class ReleasesSyncRequest extends FormRequest
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
        return [];
    }
}
