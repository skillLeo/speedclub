<?php

namespace App\Services\Shop;

use App\Enums\ShopBannerLink;
use App\Enums\ShopCategory;
use App\Models\ShopBanner;
use App\Models\ShopProduct;
use App\Services\Shop\Views\ShopCategoryCount;
use App\Services\Shop\Views\ShopHeroView;
use App\Services\Shop\Views\ShopPage;
use App\Services\Shop\Views\ShopProductView;
use App\Services\Showcase\SampleContent;
use Illuminate\Database\Eloquent\Builder;
use Illuminate\Support\Facades\Gate;

/**
 * The ADM-66 catalogue (m5.5-contract §2): visible, not deleted products with at least one photo; samples (is_sample) only while
 * editorial_samples is on (09 §8.19, SampleContent). Order `sort`, then id; cursor pages. The hero is the active banner while what it
 * links to can be shown. A single product goes through ShopProductPolicy, the list through the same rule as a query.
 */
final class LocalShopCatalogue implements ShopCatalogue
{
    public function __construct(
        private readonly ShopViews $views,
        private readonly SampleContent $samples,
        private readonly ShopCategories $categories,
    ) {}

    public function driver(): string
    {
        return 'local';
    }

    public function hero(): ?ShopHeroView
    {
        $query = ShopBanner::query()->where('active', true)->latest('updated_at')->latest('id');
        $banner = $this->samples->constrain($query, 'shop_banners.is_sample')->first();

        if ($banner === null) {
            return null;
        }

        if (! $this->bannerLinkShown($banner)) {
            return null;
        }

        return $this->views->hero($banner, $banner->link_kind === ShopBannerLink::Product ? $banner->product : null);
    }

    /**
     * Whether a member could follow the banner: its product can be shown, or its category lists at least one product (a hero that
     * leads to an empty grid is not shown, review nit). ADM-67's `link_ok` uses the same answer.
     */
    public function bannerLinkShown(ShopBanner $banner): bool
    {
        if ($banner->link_kind === ShopBannerLink::Product) {
            $product = $banner->product;

            return $product !== null && $this->shown($product);
        }

        return $banner->category !== null && $this->listed()->where('shop_products.category', $banner->category->value)->exists();
    }

    public function categories(): array
    {
        /** @var array<string, int> $counts */
        $counts = $this->listed()->toBase()->selectRaw('category, count(*) as aggregate')->groupBy('category')->pluck('aggregate', 'category')->map(fn (mixed $count): int => (int) $count)->all();
        $rows = [new ShopCategoryCount(null, array_sum($counts))];

        foreach (ShopCategory::cases() as $category) {
            $rows[] = new ShopCategoryCount($category, $counts[$category->value] ?? 0, $this->categories->status($category));
        }

        return $rows;
    }

    public function products(?ShopCategory $category, int $perPage, ?string $cursor): ShopPage
    {
        $page = $this->listed()
            ->when($category !== null, fn (Builder $query) => $query->where('shop_products.category', $category?->value))
            ->with('images')
            ->orderBy('shop_products.sort')->orderBy('shop_products.id')
            ->cursorPaginate($perPage, ['shop_products.*'], 'cursor', $cursor);

        /** @var list<ShopProduct> $rows */
        $rows = array_values($page->items());

        return new ShopPage(
            items: array_map(fn (ShopProduct $product): ShopProductView => $this->views->product($product), $rows),
            perPage: $perPage,
            nextCursor: $page->nextCursor()?->encode(),
            prevCursor: $page->previousCursor()?->encode(),
        );
    }

    public function product(string $idOrSlug): ?ShopProductView
    {
        $product = null;

        // A 26-character value may be a ULID or a slug of one long word ("kennzeichenhalterungsschild"): the id first, then the slug
        // (review SF-2).
        if (preg_match('/\A[0-9A-Za-z]{26}\z/', $idOrSlug) === 1) {
            $product = ShopProduct::query()->with('images')->whereKey(strtolower($idOrSlug))->first();
        }

        if ($product === null && preg_match('/\A[a-z0-9-]{1,140}\z/', $idOrSlug) === 1) {
            $product = ShopProduct::query()->with('images')->where('slug', $idOrSlug)->first();
        }

        if ($product === null || ! $this->shown($product)) {
            return null;
        }

        return $this->views->product($product);
    }

    /**
     * A product a member may open: the policy, and its category is open (R4-3.2).
     */
    private function shown(ShopProduct $product): bool
    {
        return Gate::forUser(null)->allows('view', $product) && $this->categories->isAvailable($product->category);
    }

    /**
     * Only open categories (R4-3.2): a coming_soon category lists nothing and counts 0, and "Alle" leaves its products out.
     *
     * @return Builder<ShopProduct>
     */
    private function listed(): Builder
    {
        return $this->samples->constrain(ShopProduct::query()->listed(), 'shop_products.is_sample')
            ->whereIn('shop_products.category', $this->categories->availableValues());
    }
}
