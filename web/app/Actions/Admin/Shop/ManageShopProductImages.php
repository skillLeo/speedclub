<?php

namespace App\Actions\Admin\Shop;

use App\Enums\ShopAuditEvent;
use App\Models\ShopProduct;
use App\Models\ShopProductImage;
use App\Models\Staff;
use App\Services\Audit\Audit;
use App\Services\Shop\ShopImages;
use Illuminate\Http\UploadedFile;
use Illuminate\Support\Facades\DB;
use Illuminate\Validation\ValidationException;
use Throwable;

/**
 * ADM-66 product photos (m5.5-contract §1, §5): upload (re-encoded, EXIF/GPS stripped, cropped to 4:5 around the focal point, at most
 * speedclub.shop.max_images), alt text and focal point (the crop again from the private original), order, and removal (files gone; a
 * visible product keeps at least one photo). Files are written before the row and removed again when the transaction fails.
 */
class ManageShopProductImages
{
    public function __construct(private readonly ShopImages $images) {}

    /**
     * @param  array{alt?: string|null, focal_x?: float|int|string, focal_y?: float|int|string}  $data
     *
     * @throws ValidationException
     */
    public function add(Staff $staff, ShopProduct $product, UploadedFile $file, array $data, ?string $reason): ShopProductImage
    {
        $max = config()->integer('speedclub.shop.max_images');

        if ($product->images()->count() >= $max) {
            throw ValidationException::withMessages(['file' => [(string) __('shop.upload.too_many', ['max' => $max])]]);
        }

        $columns = $this->images->product($product->id, $this->images->read($file), (float) ($data['focal_x'] ?? 0.5), (float) ($data['focal_y'] ?? 0.5));

        try {
            return DB::transaction(function () use ($staff, $product, $columns, $data, $reason, $max): ShopProductImage {
                ShopProduct::query()->whereKey($product->id)->lockForUpdate()->firstOrFail();
                $count = ShopProductImage::query()->where('shop_product_id', $product->id)->count();

                if ($count >= $max) {
                    throw ValidationException::withMessages(['file' => [(string) __('shop.upload.too_many', ['max' => $max])]]);
                }

                $image = new ShopProductImage;
                $image->forceFill([
                    ...$columns,
                    'shop_product_id' => $product->id,
                    'sort' => ((int) ShopProductImage::query()->where('shop_product_id', $product->id)->max('sort')) + 1,
                    'alt' => self::alt($data['alt'] ?? null),
                    'uploaded_by' => $staff->id,
                ])->save();
                $product->forceFill(['updated_by' => $staff->id])->save();
                Audit::record(ShopAuditEvent::ImageAdded->value, $product, null, ['image' => $image->id, 'width' => $image->width, 'height' => $image->height, 'alt' => $image->alt], $reason, $staff);

                return $image;
            });
        } catch (Throwable $error) {
            $this->images->delete($columns['variants'], $columns['original_path']);

            throw $error;
        }
    }

    /**
     * @param  array{alt?: string|null, focal_x?: float|int|string, focal_y?: float|int|string}  $data
     */
    public function change(Staff $staff, ShopProductImage $image, array $data, ?string $reason): ShopProductImage
    {
        $before = ['alt' => $image->alt, 'focal_x' => $image->focal_x, 'focal_y' => $image->focal_y];
        $focalX = array_key_exists('focal_x', $data) ? round((float) $data['focal_x'], 3) : $image->focal_x;
        $focalY = array_key_exists('focal_y', $data) ? round((float) $data['focal_y'], 3) : $image->focal_y;
        $recrop = abs($focalX - $image->focal_x) > 0.0005 || abs($focalY - $image->focal_y) > 0.0005;
        $columns = $recrop ? $this->images->recrop($image, $focalX, $focalY) : null;
        $oldVariants = $image->variants;

        try {
            $updated = DB::transaction(function () use ($staff, $image, $data, $columns, $before, $reason): ShopProductImage {
                /** @var ShopProductImage $locked */
                $locked = ShopProductImage::query()->whereKey($image->id)->lockForUpdate()->firstOrFail();

                if (array_key_exists('alt', $data)) {
                    $locked->forceFill(['alt' => self::alt($data['alt'])]);
                }

                if ($columns !== null) {
                    $locked->forceFill($columns);
                }

                if ($locked->isDirty()) {
                    $locked->save();
                    $after = ['alt' => $locked->alt, 'focal_x' => $locked->focal_x, 'focal_y' => $locked->focal_y];
                    Audit::record(ShopAuditEvent::ImageUpdated->value, $locked->product, ['image' => $locked->id, ...$before], ['image' => $locked->id, ...$after], $reason, $staff);
                }

                return $locked;
            });
        } catch (Throwable $error) {
            if ($columns !== null) {
                $this->images->delete($columns['variants']);
            }

            throw $error;
        }

        if ($columns !== null) {
            $this->images->delete(array_diff($oldVariants, $columns['variants']));
        }

        return $updated;
    }

    /**
     * @param  list<string>  $ids  every photo of the product in the new order
     *
     * @throws ValidationException
     */
    public function reorder(Staff $staff, ShopProduct $product, array $ids, ?string $reason): void
    {
        DB::transaction(function () use ($staff, $product, $ids, $reason): void {
            $before = array_values(ShopProductImage::query()->where('shop_product_id', $product->id)->lockForUpdate()->orderBy('sort')->orderBy('id')->pluck('id')->all());
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
                ShopProductImage::query()->whereKey($id)->update(['sort' => $index + 1]);
            }

            Audit::record(ShopAuditEvent::ImagesReordered->value, $product, ['order' => $before], ['order' => $ids], $reason, $staff);
        });
    }

    /**
     * @throws ValidationException when it is the last photo of a visible product
     */
    public function remove(Staff $staff, ShopProductImage $image, ?string $reason): void
    {
        $files = DB::transaction(function () use ($staff, $image, $reason): array {
            /** @var ShopProduct $product */
            $product = ShopProduct::withTrashed()->whereKey($image->shop_product_id)->lockForUpdate()->firstOrFail();
            /** @var ShopProductImage $locked */
            $locked = ShopProductImage::query()->whereKey($image->id)->lockForUpdate()->firstOrFail();

            if ($product->visible && ! $product->trashed() && ShopProductImage::query()->where('shop_product_id', $product->id)->count() <= 1) {
                throw ValidationException::withMessages(['image' => [(string) __('shop.upload.last_image')]]);
            }

            $files = [$locked->variants, $locked->original_path];
            $locked->delete();
            Audit::record(ShopAuditEvent::ImageRemoved->value, $product, ['image' => $locked->id, 'alt' => $locked->alt], null, $reason, $staff);

            return $files;
        });

        $this->images->delete($files[0], $files[1]);
    }

    private static function alt(mixed $value): ?string
    {
        return is_string($value) && trim($value) !== '' ? trim($value) : null;
    }
}
