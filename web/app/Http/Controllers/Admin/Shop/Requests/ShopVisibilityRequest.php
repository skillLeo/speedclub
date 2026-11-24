<?php

namespace App\Http\Controllers\Admin\Shop\Requests;

/**
 * ADM-66 "Anzeigen" / "Ausblenden": a product is shown only when complete (ManageShopProducts::missing()).
 */
class ShopVisibilityRequest extends ShopFormRequest
{
    /**
     * @return array<string, mixed>
     */
    protected function extraRules(): array
    {
        return ['visible' => ['required', 'boolean']];
    }
}
