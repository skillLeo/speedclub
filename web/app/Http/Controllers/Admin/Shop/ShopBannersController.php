<?php

namespace App\Http\Controllers\Admin\Shop;

use App\Actions\Admin\Shop\ManageShopBanners;
use App\Enums\ShopCategory;
use App\Http\Controllers\Admin\Shop\Requests\ShopBannerRequest;
use App\Http\Controllers\Admin\Shop\Requests\ShopStateRequest;
use App\Http\Controllers\Controller;
use App\Models\ShopBanner;
use App\Models\ShopProduct;
use App\Models\Staff;
use App\Services\Shop\LocalShopCatalogue;
use App\Services\Shop\ShopImages;
use Illuminate\Http\JsonResponse;
use Illuminate\Http\RedirectResponse;
use Illuminate\Http\Request;
use Inertia\Inertia;
use Inertia\Response;

/**
 * ADM-67 Shop-Banner (m5.5-contract §5): the SHOP-01 heroes, one active at a time. List, create (inactive), edit, activate, deactivate,
 * delete ⚿. Atom shop.manage on every route and in every FormRequest; the delete also needs the recent password (ADR-215).
 */
class ShopBannersController extends Controller
{
    public function index(Request $request, ShopImages $images, LocalShopCatalogue $catalogue): Response
    {
        /** @var Staff $staff */
        $staff = $request->user('staff');
        $banners = ShopBanner::query()->with('product.images')->orderByDesc('active')->latest('updated_at')->latest('id')->get();
        $editors = Staff::query()->whereIn('id', $banners->pluck('updated_by')->filter()->unique()->values()->all())->pluck('name', 'id')->all();

        return Inertia::render('Shop/Banners/Index', [
            'banners' => array_values($banners->map(fn (ShopBanner $banner): array => self::row($banner, $images, $catalogue, $editors))->all()),
            'products' => fn (): array => array_values(ShopProduct::query()->orderBy('sort')->orderBy('id')->get(['id', 'title', 'visible'])
                ->map(fn (ShopProduct $product): array => ['value' => $product->id, 'label' => $product->title, 'visible' => $product->visible])->all()),
            'categories' => ShopProductsController::options(ShopCategory::cases()),
            'limits' => [
                'min_width' => config()->integer('speedclub.shop.image.banner_min_width'),
                'max_upload_kb' => config()->integer('speedclub.shop.image.max_upload_kb'),
            ],
            'canManage' => $staff->can('shop.manage'),
        ]);
    }

    public function store(ShopBannerRequest $request, ManageShopBanners $banners): RedirectResponse|JsonResponse
    {
        $upload = $request->upload();
        abort_if($upload === null, 422);
        $data = $request->fields();
        unset($data['file']);

        return $this->done($request, $banners->add($request->staff(), $upload, $data, $request->reason()), 'banner_created', 201);
    }

    public function update(ShopBannerRequest $request, string $banner, ManageShopBanners $banners): RedirectResponse|JsonResponse
    {
        $data = $request->fields();
        unset($data['file']);

        return $this->done($request, $banners->change($request->staff(), self::find($banner), $data, $request->upload(), $request->reason()), 'banner_updated');
    }

    public function activate(ShopStateRequest $request, string $banner, ManageShopBanners $banners): RedirectResponse|JsonResponse
    {
        return $this->done($request, $banners->activate($request->staff(), self::find($banner), true, $request->reason()), 'banner_activated');
    }

    public function deactivate(ShopStateRequest $request, string $banner, ManageShopBanners $banners): RedirectResponse|JsonResponse
    {
        return $this->done($request, $banners->activate($request->staff(), self::find($banner), false, $request->reason()), 'banner_deactivated');
    }

    public function destroy(ShopStateRequest $request, string $banner, ManageShopBanners $banners): RedirectResponse|JsonResponse
    {
        $model = self::find($banner);
        $banners->remove($request->staff(), $model, $request->reason());

        if ($request->expectsJson() && ! $request->hasHeader('X-Inertia')) {
            return response()->json(['id' => $model->id, 'deleted' => true]);
        }

        return back(303)->with('success', 'shop.flash.banner_deleted');
    }

    /**
     * @param  array<int|string, string>  $editors  staff id => name
     * @return array<string, mixed>
     */
    private static function row(ShopBanner $banner, ShopImages $images, LocalShopCatalogue $catalogue, array $editors): array
    {
        $product = $banner->product;
        // The member hero's own rule: a hidden product or an empty category is not followed (LocalShopCatalogue::bannerLinkShown).
        $linkOk = $catalogue->bannerLinkShown($banner);

        return [
            'id' => $banner->id,
            'title' => $banner->title,
            'subtitle' => $banner->subtitle,
            'active' => $banner->active,
            'is_sample' => $banner->is_sample,
            'link' => [
                'kind' => $banner->link_kind->value,
                'category' => $banner->category?->value,
                'product' => $product === null ? null : ['id' => $product->id, 'title' => $product->title, 'visible' => $product->visible && ! $product->trashed()],
            ],
            'link_ok' => $linkOk,
            'image' => [
                'url' => $images->variantUrl($banner, 1080),
                'width' => $banner->width,
                'height' => $banner->height,
                'focal_x' => $banner->focal_x,
                'focal_y' => $banner->focal_y,
                'blurhash' => $banner->blurhash,
                'alt' => $banner->alt,
            ],
            'updated_at' => $banner->updated_at?->toIso8601String(),
            'updated_by' => $banner->updated_by === null ? null : ($editors[$banner->updated_by] ?? null),
        ];
    }

    private static function find(string $id): ShopBanner
    {
        $banner = preg_match('/\A[0-9A-Za-z]{26}\z/', $id) === 1 ? ShopBanner::query()->find(strtolower($id)) : null;
        abort_if($banner === null, 404);

        return $banner;
    }

    private function done(Request $request, ShopBanner $banner, string $outcome, int $status = 200): RedirectResponse|JsonResponse
    {
        if ($request->expectsJson() && ! $request->hasHeader('X-Inertia')) {
            return response()->json(['id' => $banner->id, 'active' => $banner->active], $status);
        }

        return back(303)->with('success', "shop.flash.$outcome");
    }
}
