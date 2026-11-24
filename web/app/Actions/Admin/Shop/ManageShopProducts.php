<?php

namespace App\Actions\Admin\Shop;

use App\Enums\ShopAuditEvent;
use App\Enums\ShopPurchaseMode;
use App\Models\ShopProduct;
use App\Models\Staff;
use App\Services\Audit\Audit;
use App\Services\Shop\ShopLinks;
use App\Support\Slug;
use Illuminate\Database\UniqueConstraintViolationException;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Str;
use Illuminate\Validation\ValidationException;

/**
 * ADM-66 Shop-Produkte (10 §3, m5.5-contract §5): create (hidden, at the end of the order), edit, show/hide, reorder, delete (soft, comes
 * back hidden within speedclub.shop.purge_after_days) and restore. A product is shown only when complete: at least one photo and either
 * the sticker designer or a Shopify URL that is still allowed (badged samples may lack the URL). Every change is audited with before and
 * after; shop.manage is checked on the route and in the FormRequest.
 */
class ManageShopProducts
{
    public function __construct(private readonly ShopLinks $links) {}

    /**
     * @param  array<string, mixed>  $data  title, category, price_cents and the optional fields of ShopProductRequest
     */
    public function add(Staff $staff, array $data, ?string $reason): ShopProduct
    {
        // Two creates with the same title can both find the slug free; the unique index refuses the second, which then tries once more
        // with a fresh slug (review nit).
        try {
            return $this->insert($staff, $data, $reason);
        } catch (UniqueConstraintViolationException) {
            return $this->insert($staff, $data, $reason);
        }
    }

    /**
     * @param  array<string, mixed>  $data
     */
    private function insert(Staff $staff, array $data, ?string $reason): ShopProduct
    {
        return DB::transaction(function () use ($staff, $data, $reason): ShopProduct {
            $product = new ShopProduct;
            $product->forceFill([
                ...$this->clean($data, null),
                'sort' => ((int) ShopProduct::withTrashed()->lockForUpdate()->max('sort')) + 1,
                'visible' => false,
                'is_sample' => false,
                'created_by' => $staff->id,
                'updated_by' => $staff->id,
            ]);
            $product->forceFill(['slug' => $this->uniqueSlug(is_string($data['slug'] ?? null) && $data['slug'] !== '' ? $data['slug'] : $product->title)])->save();
            Audit::record(ShopAuditEvent::ProductCreated->value, $product, null, self::snapshot($product), $reason, $staff);

            return $product;
        });
    }

    /**
     * @param  array<string, mixed>  $data  the keys sent
     *
     * @throws ValidationException when a visible product would become incomplete
     */
    public function change(Staff $staff, ShopProduct $product, array $data, ?string $reason): ShopProduct
    {
        return DB::transaction(function () use ($staff, $product, $data, $reason): ShopProduct {
            $locked = $this->lock($product);
            $before = self::snapshot($locked);
            $locked->forceFill($this->clean($data, $locked));

            if (array_key_exists('slug', $data) && is_string($data['slug']) && $data['slug'] !== '' && $data['slug'] !== $locked->getOriginal('slug')) {
                $locked->forceFill(['slug' => $this->uniqueSlug($data['slug'], $locked->id)]);
            }

            if (! $locked->isDirty()) {
                return $locked;
            }

            if ($locked->visible) {
                $this->assertComplete($locked);
            }

            $locked->forceFill(['updated_by' => $staff->id])->save();
            Audit::record(ShopAuditEvent::ProductUpdated->value, $locked, ...self::diff($before, self::snapshot($locked)), reason: $reason, actor: $staff);

            return $locked;
        });
    }

    /**
     * @throws ValidationException when showing an incomplete product
     */
    public function visibility(Staff $staff, ShopProduct $product, bool $visible, ?string $reason): ShopProduct
    {
        return DB::transaction(function () use ($staff, $product, $visible, $reason): ShopProduct {
            $locked = $this->lock($product);

            if ($locked->visible === $visible) {
                return $locked;
            }

            if ($visible) {
                $this->assertComplete($locked);
            }

            $locked->forceFill(['visible' => $visible, 'updated_by' => $staff->id])->save();
            $event = $visible ? ShopAuditEvent::ProductShown : ShopAuditEvent::ProductHidden;
            Audit::record($event->value, $locked, ['visible' => ! $visible], ['visible' => $visible, 'title' => $locked->title], $reason, $staff);

            return $locked;
        });
    }

    /**
     * The new order of every product that is not deleted ($ids must be exactly that set).
     *
     * @param  list<string>  $ids
     *
     * @throws ValidationException
     */
    public function reorder(Staff $staff, array $ids, ?string $reason): void
    {
        DB::transaction(function () use ($staff, $ids, $reason): void {
            $rows = ShopProduct::query()->lockForUpdate()->orderBy('sort')->orderBy('id')->get(['id', 'sort']);
            $before = array_values($rows->pluck('id')->all());
            $current = $before;
            $given = $ids;
            sort($current);
            sort($given);

            if ($current !== $given) {
                throw ValidationException::withMessages(['ids' => [(string) __('shop.validation.order')]]);
            }

            if ($before === $ids) {
                return;
            }

            foreach ($ids as $index => $id) {
                ShopProduct::query()->whereKey($id)->update(['sort' => $index + 1, 'updated_by' => $staff->id]);
            }

            Audit::record(ShopAuditEvent::ProductsReordered->value, null, ['order' => $before], ['order' => $ids], $reason, $staff);
        });
    }

    public function remove(Staff $staff, ShopProduct $product, ?string $reason): void
    {
        DB::transaction(function () use ($staff, $product, $reason): void {
            $locked = $this->lock($product);
            $before = self::snapshot($locked);
            $locked->forceFill(['visible' => false, 'updated_by' => $staff->id])->save();
            $locked->delete();
            Audit::record(ShopAuditEvent::ProductDeleted->value, $locked, $before, ['deleted' => true], $reason, $staff);
        });
    }

    public function bringBack(Staff $staff, ShopProduct $product, ?string $reason): ShopProduct
    {
        return DB::transaction(function () use ($staff, $product, $reason): ShopProduct {
            /** @var ShopProduct $locked */
            $locked = ShopProduct::withTrashed()->whereKey($product->id)->lockForUpdate()->firstOrFail();

            if (! $locked->trashed()) {
                return $locked;
            }

            $locked->restore();
            // Back at the end of the order, as a new product: its old place may belong to another product by now (review nit).
            $sort = ((int) ShopProduct::query()->whereKeyNot($locked->id)->lockForUpdate()->max('sort')) + 1;
            $locked->forceFill(['visible' => false, 'sort' => $sort, 'updated_by' => $staff->id])->save();
            Audit::record(ShopAuditEvent::ProductRestored->value, $locked, ['deleted' => true], ['deleted' => false, 'visible' => false], $reason, $staff);

            return $locked;
        });
    }

    /**
     * What keeps a product from being shown: `image` (no photo) and/or `shopify_url` (no allowed store address; not for the designer
     * or for badged samples).
     *
     * @return list<'image'|'shopify_url'>
     */
    public function missing(ShopProduct $product): array
    {
        $missing = [];

        if (! $product->images()->exists()) {
            $missing[] = 'image';
        }

        if ($product->purchase_mode === ShopPurchaseMode::Shopify && ! $product->is_sample
            && ($product->shopify_url === null || $this->links->normalise($product->shopify_url) === null)) {
            $missing[] = 'shopify_url';
        }

        return $missing;
    }

    /**
     * @return array<string, mixed>
     */
    public static function snapshot(ShopProduct $product): array
    {
        return [
            'slug' => $product->slug,
            'title' => $product->title,
            'description' => $product->description,
            'category' => $product->category->value,
            'price_cents' => $product->price_cents,
            'currency' => $product->currency,
            'variant_kind' => $product->variant_kind->value,
            'variants' => $product->variantList(),
            'purchase_mode' => $product->purchase_mode->value,
            'shopify_url' => $product->shopify_url,
            'visible' => $product->visible,
            'sort' => $product->sort,
        ];
    }

    /**
     * @throws ValidationException
     */
    private function assertComplete(ShopProduct $product): void
    {
        $missing = $this->missing($product);

        if ($missing !== []) {
            $labels = implode(', ', array_map(fn (string $key): string => (string) __('shop.validation.missing.'.$key), $missing));

            throw ValidationException::withMessages(['visible' => [(string) __('shop.validation.incomplete', ['missing' => $labels])]]);
        }
    }

    /**
     * @param  array<string, mixed>  $data
     * @return array<string, mixed>
     */
    private function clean(array $data, ?ShopProduct $product): array
    {
        $fields = [];

        foreach (['title', 'category', 'price_cents', 'currency', 'variant_kind', 'purchase_mode'] as $key) {
            if (array_key_exists($key, $data)) {
                $fields[$key] = is_string($data[$key]) ? trim($data[$key]) : $data[$key];
            }
        }

        if (array_key_exists('description', $data)) {
            $text = is_string($data['description']) ? trim(str_replace(["\r\n", "\r"], "\n", $data['description'])) : '';
            $fields['description'] = $text === '' ? null : $text;
        }

        if (array_key_exists('shopify_url', $data)) {
            $fields['shopify_url'] = is_string($data['shopify_url']) && trim($data['shopify_url']) !== '' ? $this->links->normalise($data['shopify_url']) : null;
        }

        if (array_key_exists('variants', $data)) {
            $fields['variants'] = $this->variants(is_array($data['variants']) ? $data['variants'] : []);
        }

        return $fields;
    }

    /**
     * Chips with stable ids: a sent id is kept (once), a new chip gets a fresh one.
     *
     * @param  array<int|string, mixed>  $input
     * @return list<array{id: string, label: string, shopify_variant_id: string|null}>
     */
    private function variants(array $input): array
    {
        $variants = [];
        $seen = [];

        foreach ($input as $row) {
            if (! is_array($row) || ! is_string($row['label'] ?? null) || trim($row['label']) === '') {
                continue;
            }

            $id = is_string($row['id'] ?? null) && preg_match('/\A[0-9a-z]{8}\z/', $row['id']) === 1 && ! isset($seen[$row['id']]) ? $row['id'] : $this->variantId($seen);
            $seen[$id] = true;
            $shopify = $row['shopify_variant_id'] ?? null;
            $variants[] = ['id' => $id, 'label' => trim($row['label']), 'shopify_variant_id' => is_string($shopify) && $shopify !== '' ? $shopify : null];
        }

        return $variants;
    }

    /**
     * @param  array<string, true>  $seen
     */
    private function variantId(array $seen): string
    {
        do {
            $id = strtolower(Str::random(8));
        } while (isset($seen[$id]) || preg_match('/\A[0-9a-z]{8}\z/', $id) !== 1);

        return $id;
    }

    private function uniqueSlug(string $text, ?string $except = null): string
    {
        $base = Str::limit(Slug::make($text), 130, '') ?: 'produkt';
        $base = rtrim($base, '-');
        $slug = $base;
        $suffix = 2;

        while (ShopProduct::withTrashed()->where('slug', $slug)->when($except !== null, fn ($query) => $query->whereKeyNot($except))->exists()) {
            $slug = $base.'-'.$suffix++;
        }

        return $slug;
    }

    private function lock(ShopProduct $product): ShopProduct
    {
        /** @var ShopProduct $locked */
        $locked = ShopProduct::query()->whereKey($product->id)->lockForUpdate()->firstOrFail();

        return $locked;
    }

    /**
     * Only the fields that changed, before and after.
     *
     * @param  array<string, mixed>  $before
     * @param  array<string, mixed>  $after
     * @return array{before: array<string, mixed>, after: array<string, mixed>}
     */
    private static function diff(array $before, array $after): array
    {
        $changed = array_keys(array_filter($after, fn (mixed $value, string $key): bool => ($before[$key] ?? null) !== $value, ARRAY_FILTER_USE_BOTH));

        return ['before' => array_intersect_key($before, array_flip($changed)), 'after' => array_intersect_key($after, array_flip($changed))];
    }
}
