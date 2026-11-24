<?php

namespace App\Http\Controllers\Admin\Shop;

use App\Actions\Admin\Shop\ManageShopProductImages;
use App\Http\Controllers\Admin\Shop\Requests\ShopImageRequest;
use App\Http\Controllers\Admin\Shop\Requests\ShopReorderRequest;
use App\Http\Controllers\Admin\Shop\Requests\ShopStateRequest;
use App\Http\Controllers\Controller;
use App\Models\ShopProductImage;
use Illuminate\Http\JsonResponse;
use Illuminate\Http\RedirectResponse;
use Illuminate\Http\Request;

/**
 * ADM-66 product photos (m5.5-contract §5): upload (4:5 crop, re-encoded), alt text and focal point, order, removal. Atom shop.manage on
 * the route and in the FormRequests; every change audited by ManageShopProductImages.
 */
class ShopProductImagesController extends Controller
{
    public function store(ShopImageRequest $request, string $product, ManageShopProductImages $images): RedirectResponse|JsonResponse
    {
        /** @var array{alt?: string|null, focal_x?: float|int|string, focal_y?: float|int|string} $data */
        $data = $request->safe()->only(['alt', 'focal_x', 'focal_y']);
        $image = $images->add($request->staff(), ShopProductsController::find($product), $request->upload(), $data, $request->reason());

        return $this->done($request, $image, 'image_added', 201);
    }

    public function update(ShopImageRequest $request, string $product, string $image, ManageShopProductImages $images): RedirectResponse|JsonResponse
    {
        /** @var array{alt?: string|null, focal_x?: float|int|string, focal_y?: float|int|string} $data */
        $data = $request->safe()->only(['alt', 'focal_x', 'focal_y']);

        return $this->done($request, $images->change($request->staff(), self::find($product, $image), $data, $request->reason()), 'image_updated');
    }

    public function reorder(ShopReorderRequest $request, string $product, ManageShopProductImages $images): RedirectResponse|JsonResponse
    {
        $images->reorder($request->staff(), ShopProductsController::find($product), $request->ids(), $request->reason());

        if ($request->expectsJson() && ! $request->hasHeader('X-Inertia')) {
            return response()->json(['ids' => $request->ids()]);
        }

        return back(303)->with('success', 'shop.flash.images_reordered');
    }

    public function destroy(ShopStateRequest $request, string $product, string $image, ManageShopProductImages $images): RedirectResponse|JsonResponse
    {
        $model = self::find($product, $image);
        $images->remove($request->staff(), $model, $request->reason());

        if ($request->expectsJson() && ! $request->hasHeader('X-Inertia')) {
            return response()->json(['id' => $model->id, 'deleted' => true]);
        }

        return back(303)->with('success', 'shop.flash.image_removed');
    }

    private static function find(string $product, string $image): ShopProductImage
    {
        $parent = ShopProductsController::find($product);
        $model = preg_match('/\A[0-9A-Za-z]{26}\z/', $image) === 1
            ? ShopProductImage::query()->where('shop_product_id', $parent->id)->find(strtolower($image))
            : null;
        abort_if($model === null, 404);
        $model->setRelation('product', $parent);

        return $model;
    }

    private function done(Request $request, ShopProductImage $image, string $outcome, int $status = 200): RedirectResponse|JsonResponse
    {
        if ($request->expectsJson() && ! $request->hasHeader('X-Inertia')) {
            return response()->json(['id' => $image->id, 'product' => $image->shop_product_id, 'focal_x' => $image->focal_x, 'focal_y' => $image->focal_y], $status);
        }

        return back(303)->with('success', "shop.flash.$outcome");
    }
}
