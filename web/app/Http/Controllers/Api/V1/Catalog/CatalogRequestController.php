<?php

namespace App\Http\Controllers\Api\V1\Catalog;

use App\Actions\Catalog\CreateCatalogRequest;
use App\Http\Controllers\Controller;
use App\Http\Requests\Api\V1\Catalog\StoreCatalogRequestRequest;
use App\Http\Resources\V1\CatalogRequestResource;
use App\Models\CatalogRequest;
use App\Models\User;
use Illuminate\Support\Facades\Gate;

class CatalogRequestController extends Controller
{
    /**
     * Suggest a missing make, model or generation.
     *
     * Accepts an Idempotency-Key header.
     */
    public function store(StoreCatalogRequestRequest $request, CreateCatalogRequest $action): CatalogRequestResource
    {
        Gate::authorize('create', CatalogRequest::class);

        /** @var User $user */
        $user = $request->user();
        /** @var array{vehicle_id?: string|null, make_text?: string|null, model_text?: string|null, generation_text?: string|null} $attributes */
        $attributes = $request->validated();

        /** @status 201 */
        return new CatalogRequestResource($action->handle($user, $attributes));
    }
}
