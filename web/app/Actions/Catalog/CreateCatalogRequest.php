<?php

namespace App\Actions\Catalog;

use App\Models\CatalogRequest;
use App\Models\User;

class CreateCatalogRequest
{
    /**
     * @param  array{vehicle_id?: string|null, make_text?: string|null, model_text?: string|null, generation_text?: string|null}  $attributes
     */
    public function handle(User $user, array $attributes): CatalogRequest
    {
        $request = new CatalogRequest($attributes);
        $request->forceFill(['user_id' => $user->id])->save();

        return $request->refresh();
    }
}
