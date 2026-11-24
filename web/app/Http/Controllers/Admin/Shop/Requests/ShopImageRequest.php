<?php

namespace App\Http\Controllers\Admin\Shop\Requests;

use Illuminate\Http\UploadedFile;

/**
 * ADM-66 photo upload (POST: file required) and edit (PATCH: alt text, focal point → the 4:5 crop again from the private original).
 * The type, size and pixel checks by content happen in ShopImages.
 */
class ShopImageRequest extends ShopFormRequest
{
    /**
     * @return array<string, mixed>
     */
    protected function extraRules(): array
    {
        return [
            'file' => [$this->isMethod('POST') ? 'required' : 'prohibited', 'file', 'max:'.config()->integer('speedclub.shop.image.max_upload_kb')],
            'alt' => ['sometimes', 'nullable', 'string', 'max:200'],
            'focal_x' => ['sometimes', 'numeric', 'between:0,1'],
            'focal_y' => ['sometimes', 'numeric', 'between:0,1'],
        ];
    }

    public function upload(): UploadedFile
    {
        /** @var UploadedFile $file */
        $file = $this->file('file');

        return $file;
    }
}
