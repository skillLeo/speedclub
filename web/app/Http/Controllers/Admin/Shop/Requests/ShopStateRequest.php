<?php

namespace App\Http\Controllers\Admin\Shop\Requests;

/**
 * ADM-66/67 delete, restore, activate, deactivate: only the optional reason.
 */
class ShopStateRequest extends ShopFormRequest
{
    /**
     * @return array<string, mixed>
     */
    protected function extraRules(): array
    {
        return [];
    }
}
