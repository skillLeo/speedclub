<?php

namespace App\Http\Controllers\Admin\Shop\Requests;

/**
 * ADM-66 order of the products, or of one product's photos: the full list of ids in the new order (the Action checks the set).
 */
class ShopReorderRequest extends ShopFormRequest
{
    /**
     * @return array<string, mixed>
     */
    protected function extraRules(): array
    {
        return [
            'ids' => ['required', 'array', 'min:1', 'max:500'],
            'ids.*' => ['required', 'string', 'regex:/\A[0-9A-Za-z]{26}\z/', 'distinct'],
        ];
    }

    /**
     * @return list<string>
     */
    public function ids(): array
    {
        /** @var list<string> $ids */
        $ids = $this->validated('ids');

        return array_map('strtolower', $ids);
    }
}
