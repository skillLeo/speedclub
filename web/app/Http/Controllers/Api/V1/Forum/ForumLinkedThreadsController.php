<?php

namespace App\Http\Controllers\Api\V1\Forum;

use App\Enums\ErrorCode;
use App\Exceptions\ApiException;
use App\Http\Controllers\Controller;
use App\Http\Requests\Api\V1\Forum\ForumPageRequest;
use App\Http\Resources\V1\Forum\ForumThreadRowResource;
use App\Models\Modification;
use App\Models\Product;
use App\Models\Vehicle;
use App\Services\Forum\ForumListing;
use App\Support\Viewer;
use Illuminate\Http\Resources\Json\AnonymousResourceCollection;
use Illuminate\Support\Facades\Gate;

/**
 * M5.8 integration (10 §7.4): the threads linked to a build (VEH-01 "Diskussionen zu diesem Build"), a mod or a parts product
 * ("Diskussionen"), newest activity first.
 */
class ForumLinkedThreadsController extends Controller
{
    public function __construct(private readonly ForumListing $listing) {}

    /**
     * Discussions about a build.
     *
     * Guests too. A build the reader may not see answers 404.
     *
     * @unauthenticated
     */
    public function vehicle(ForumPageRequest $request, string $vehicle): AnonymousResourceCollection
    {
        $model = Vehicle::query()->find(strtolower($vehicle));
        $viewer = Viewer::from($request);

        if (! $model instanceof Vehicle || ! Gate::forUser($viewer)->allows('view', $model)) {
            throw new ApiException(ErrorCode::NotFound);
        }

        return ForumThreadRowResource::collection($this->listing->linked($viewer, 'vehicle_id', $model->id, $request->pageSize()));
    }

    /**
     * Discussions about a mod.
     *
     * Guests too. A mod the reader may not see answers 404.
     *
     * @unauthenticated
     */
    public function modification(ForumPageRequest $request, string $modification): AnonymousResourceCollection
    {
        $model = Modification::query()->with('vehicle')->find(strtolower($modification));
        $viewer = Viewer::from($request);

        if (! $model instanceof Modification || ! Gate::forUser($viewer)->allows('view', $model)) {
            throw new ApiException(ErrorCode::NotFound);
        }

        return ForumThreadRowResource::collection($this->listing->linked($viewer, 'modification_id', $model->id, $request->pageSize()));
    }

    /**
     * Discussions about a product.
     *
     * Guests too. An unknown or archived product answers 404.
     *
     * @unauthenticated
     */
    public function product(ForumPageRequest $request, string $product): AnonymousResourceCollection
    {
        $model = Product::query()->find(strtolower($product));

        if (! $model instanceof Product) {
            throw new ApiException(ErrorCode::NotFound);
        }

        return ForumThreadRowResource::collection($this->listing->linked(Viewer::from($request), 'product_id', $model->id, $request->pageSize()));
    }
}
