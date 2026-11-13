<?php

namespace App\Actions\Admin\Parts;

use App\Enums\ProductAuditEvent;
use App\Enums\ProductStatus;
use App\Models\Modification;
use App\Models\Product;
use App\Models\Staff;
use App\Services\Audit\Audit;
use App\Services\Parts\ProductCatalogue;
use App\Support\Slug;
use Illuminate\Support\Facades\DB;
use Illuminate\Validation\ValidationException;

/**
 * ADM-57 Teile & Produkte (09 §8.9): staff create and edit products, archive and restore them, and merge duplicates (the mods of the
 * duplicate move to the survivor, the duplicate keeps its row with merged_into_id so old links resolve). Every change is audited with
 * before/after and the reason; catalog.manage is checked by the route and the FormRequest. A product's slug is unique per brand.
 */
class ManageProducts
{
    /**
     * @param  array<string, mixed>  $data  brand_id, category_id, name, line?, attributes?, url?, affiliate_url?, aliases?
     */
    public function add(Staff $staff, array $data, ?string $reason): Product
    {
        return DB::transaction(function () use ($staff, $data, $reason): Product {
            $product = new Product;
            $product->forceFill([...$this->clean($data), 'status' => ProductStatus::Active]);
            $product->forceFill(['slug' => $this->uniqueSlug((int) $product->brand_id, (string) $product->name)])->save();
            Audit::record(ProductAuditEvent::Created->value, $product, null, self::snapshot($product), $reason, $staff);

            return $product;
        });
    }

    /**
     * @param  array<string, mixed>  $data  the keys sent
     */
    public function change(Staff $staff, Product $product, array $data, ?string $reason): Product
    {
        return DB::transaction(function () use ($staff, $product, $data, $reason): Product {
            /** @var Product $locked */
            $locked = Product::query()->whereKey($product->id)->lockForUpdate()->firstOrFail();
            $before = self::snapshot($locked);
            $locked->forceFill($this->clean($data));

            if ($locked->isDirty(['name', 'brand_id'])) {
                $locked->forceFill(['slug' => $this->uniqueSlug((int) $locked->brand_id, (string) $locked->name, $locked->id)]);
            }

            if ($locked->isDirty()) {
                $locked->save();
                Audit::record(ProductAuditEvent::Updated->value, $locked, $before, self::snapshot($locked), $reason, $staff);
            }

            return $locked;
        });
    }

    public function archive(Staff $staff, Product $product, bool $archived, string $reason): Product
    {
        return DB::transaction(function () use ($staff, $product, $archived, $reason): Product {
            /** @var Product $locked */
            $locked = Product::query()->whereKey($product->id)->lockForUpdate()->firstOrFail();
            $target = $archived ? ProductStatus::Archived : ProductStatus::Active;

            if ($locked->status !== $target) {
                $before = $locked->status->value;
                $locked->forceFill(['status' => $target])->save();
                Audit::record(($archived ? ProductAuditEvent::Archived : ProductAuditEvent::Restored)->value, $locked, ['status' => $before], ['status' => $target->value], $reason, $staff);
            }

            return $locked;
        });
    }

    /**
     * $duplicate goes into $survivor: its mods link the survivor, its name becomes an alias of the survivor, and it is archived with
     * merged_into_id. Chains are flattened (products that pointed at the duplicate point at the survivor).
     */
    public function merge(Staff $staff, Product $duplicate, Product $survivor, string $reason): Product
    {
        if ($duplicate->id === $survivor->id || $survivor->merged_into_id !== null) {
            throw ValidationException::withMessages(['into' => ['Choose another product to merge into.']]);
        }

        return DB::transaction(function () use ($staff, $duplicate, $survivor, $reason): Product {
            Product::query()->whereKey([$duplicate->id, $survivor->id])->lockForUpdate()->get();
            $moved = Modification::withTrashed()->where('product_id', $duplicate->id)->update(['product_id' => $survivor->id, 'brand_id' => $survivor->brand_id]);
            Product::query()->where('merged_into_id', $duplicate->id)->update(['merged_into_id' => $survivor->id]);

            $aliases = array_values(array_unique([...($survivor->aliases ?? []), $duplicate->name, ...($duplicate->aliases ?? [])]));
            $survivor->forceFill(['aliases' => array_slice($aliases, 0, 20)])->save();
            $duplicate->forceFill(['merged_into_id' => $survivor->id, 'status' => ProductStatus::Archived])->save();

            Audit::record(ProductAuditEvent::Merged->value, $duplicate, ['product_id' => $duplicate->id], ['into' => $survivor->id, 'mods' => $moved], $reason, $staff);

            return $survivor;
        });
    }

    /**
     * @param  array<string, mixed>  $data
     * @return array<string, mixed>
     */
    private function clean(array $data): array
    {
        $clean = array_intersect_key($data, array_flip(['brand_id', 'category_id', 'name', 'line', 'url', 'affiliate_url', 'aliases']));

        if (array_key_exists('attributes', $data)) {
            $clean['attributes'] = ProductCatalogue::attributes($data['attributes']);
        }

        foreach (['line', 'url', 'affiliate_url'] as $key) {
            if (array_key_exists($key, $clean) && is_string($clean[$key]) && trim($clean[$key]) === '') {
                $clean[$key] = null;
            }
        }

        return $clean;
    }

    private function uniqueSlug(int $brandId, string $name, ?string $except = null): string
    {
        $base = Slug::make($name) ?: 'teil';
        $slug = $base;
        $n = 2;

        while (Product::query()->where('brand_id', $brandId)->where('slug', $slug)->when($except !== null, fn ($query) => $query->whereKeyNot($except))->exists()) {
            $slug = $base.'-'.$n++;
        }

        return $slug;
    }

    /**
     * @return array<string, mixed>
     */
    public static function snapshot(Product $product): array
    {
        return [
            'brand_id' => $product->brand_id,
            'category_id' => $product->category_id,
            'name' => $product->name,
            'line' => $product->line,
            'url' => $product->url,
            'affiliate_url' => $product->affiliate_url,
            'status' => $product->status->value,
        ];
    }
}
