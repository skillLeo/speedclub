<?php

namespace App\Http\Controllers\Admin\Brand\Requests;

use App\Enums\BrandAssetKind;
use App\Models\Staff;
use Illuminate\Foundation\Http\FormRequest;
use Illuminate\Validation\Rule;

/**
 * ADM-28 upload (`brand.manage`): the slot's kind and the file. BrandAssets checks the type by content, size, pixels and the kind's
 * minimum dimensions and re-encodes it; here only the shape of the request.
 */
class UploadBrandAssetRequest extends FormRequest
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
            'kind' => ['required', Rule::enum(BrandAssetKind::class)],
            'file' => ['required', 'file'],
            'focal_x' => ['nullable', 'numeric', 'between:0,1'],
            'focal_y' => ['nullable', 'numeric', 'between:0,1'],
        ];
    }

    public function staff(): Staff
    {
        /** @var Staff $staff */
        $staff = $this->user('staff');

        return $staff;
    }
}
