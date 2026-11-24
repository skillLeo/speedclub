<?php

namespace App\Http\Controllers\Admin\Shop\Requests;

use App\Enums\ShopBannerLink;
use App\Enums\ShopCategory;
use App\Models\ShopProduct;
use Illuminate\Http\UploadedFile;
use Illuminate\Validation\Rule;

/**
 * ADM-67 banner create (POST: file, title, link required) and edit (PATCH: the keys sent, optionally a new photo). A product link needs
 * a product that is not deleted, a category link a category.
 */
class ShopBannerRequest extends ShopFormRequest
{
    /**
     * @return array<string, mixed>
     */
    protected function extraRules(): array
    {
        $post = $this->isMethod('POST');
        $required = $post ? 'required' : 'sometimes';

        return [
            'file' => [$post ? 'required' : 'sometimes', 'file', 'max:'.config()->integer('speedclub.shop.image.max_upload_kb')],
            'title' => [$required, 'string', 'min:2', 'max:80'],
            'subtitle' => ['sometimes', 'nullable', 'string', 'max:140'],
            'link_kind' => [$required, 'string', Rule::enum(ShopBannerLink::class)],
            'product_id' => ['nullable', 'string', 'size:26', Rule::requiredIf(fn (): bool => $this->input('link_kind') === ShopBannerLink::Product->value),
                Rule::exists(ShopProduct::class, 'id')->whereNull('deleted_at')],
            'category' => ['nullable', 'string', Rule::enum(ShopCategory::class), Rule::requiredIf(fn (): bool => $this->input('link_kind') === ShopBannerLink::Category->value)],
            'alt' => ['sometimes', 'nullable', 'string', 'max:200'],
            'focal_x' => ['sometimes', 'numeric', 'between:0,1'],
            'focal_y' => ['sometimes', 'numeric', 'between:0,1'],
        ];
    }

    /**
     * @return array<string, string>
     */
    public function messages(): array
    {
        return [
            'product_id.required' => (string) __('shop.validation.banner_product'),
            'category.required' => (string) __('shop.validation.banner_category'),
        ];
    }

    public function upload(): ?UploadedFile
    {
        $file = $this->file('file');

        return $file instanceof UploadedFile ? $file : null;
    }
}
