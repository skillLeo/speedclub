<?php

namespace App\Actions\Admin\Shop;

use App\Enums\ShopAuditEvent;
use App\Enums\ShopBannerLink;
use App\Models\ShopBanner;
use App\Models\Staff;
use App\Services\Audit\Audit;
use App\Services\Shop\ShopImages;
use Illuminate\Database\Eloquent\ModelNotFoundException;
use Illuminate\Http\UploadedFile;
use Illuminate\Support\Facades\DB;
use Illuminate\Validation\ValidationException;
use Throwable;

/**
 * ADM-67 Shop-Banner (m5.5-contract §1, §5): the SHOP-01 hero. Create (inactive), edit (optionally a new photo), activate (the only active
 * one: the others are switched off in the same transaction), deactivate, delete (files gone). The photo keeps its ratio. Audited.
 */
class ManageShopBanners
{
    public function __construct(private readonly ShopImages $images) {}

    /**
     * @param  array<string, mixed>  $data  title, subtitle?, link_kind, product_id?, category?, alt?, focal_x?, focal_y?
     *
     * @throws ValidationException
     */
    public function add(Staff $staff, UploadedFile $file, array $data, ?string $reason): ShopBanner
    {
        $columns = $this->images->banner($this->images->read($file), (float) ($data['focal_x'] ?? 0.5), (float) ($data['focal_y'] ?? 0.5));

        try {
            return DB::transaction(function () use ($staff, $data, $columns, $reason): ShopBanner {
                $banner = new ShopBanner;
                $banner->forceFill([...$columns, ...$this->clean($data, null), 'active' => false, 'is_sample' => false, 'created_by' => $staff->id, 'updated_by' => $staff->id])->save();
                Audit::record(ShopAuditEvent::BannerCreated->value, $banner, null, self::snapshot($banner), $reason, $staff);

                return $banner;
            });
        } catch (Throwable $error) {
            $this->images->delete($columns['variants'], $columns['original_path']);

            throw $error;
        }
    }

    /**
     * @param  array<string, mixed>  $data  the keys sent
     *
     * @throws ValidationException
     */
    public function change(Staff $staff, ShopBanner $banner, array $data, ?UploadedFile $file, ?string $reason): ShopBanner
    {
        $columns = $file === null ? null : $this->images->banner($this->images->read($file), (float) ($data['focal_x'] ?? 0.5), (float) ($data['focal_y'] ?? 0.5));
        $old = [$banner->variants, $banner->original_path];

        try {
            $updated = DB::transaction(function () use ($staff, $banner, $data, $columns, $reason): ShopBanner {
                /** @var ShopBanner $locked */
                $locked = ShopBanner::query()->whereKey($banner->id)->lockForUpdate()->firstOrFail();
                $before = self::snapshot($locked);
                $locked->forceFill($this->clean($data, $locked));

                if ($columns !== null) {
                    $locked->forceFill($columns);
                } else {
                    foreach (['focal_x', 'focal_y'] as $key) {
                        if (array_key_exists($key, $data)) {
                            $locked->forceFill([$key => round(min(1.0, max(0.0, (float) $data[$key])), 3)]);
                        }
                    }
                }

                if ($locked->isDirty()) {
                    $locked->forceFill(['updated_by' => $staff->id])->save();
                    Audit::record(ShopAuditEvent::BannerUpdated->value, $locked, $before, [...self::snapshot($locked), 'new_image' => $columns !== null], $reason, $staff);
                }

                return $locked;
            });
        } catch (Throwable $error) {
            if ($columns !== null) {
                $this->images->delete($columns['variants'], $columns['original_path']);
            }

            throw $error;
        }

        if ($columns !== null) {
            $this->images->delete(array_diff($old[0], $columns['variants']), $old[1] !== $columns['original_path'] ? $old[1] : null);
        }

        return $updated;
    }

    public function activate(Staff $staff, ShopBanner $banner, bool $active, ?string $reason): ShopBanner
    {
        return DB::transaction(function () use ($staff, $banner, $active, $reason): ShopBanner {
            // Every banner row, locked in id order, so two concurrent switches queue up instead of deadlocking on gap locks or both
            // ending active (review nit).
            $all = ShopBanner::query()->orderBy('id')->lockForUpdate()->get();
            /** @var ShopBanner $locked */
            $locked = $all->firstWhere('id', $banner->id) ?? throw (new ModelNotFoundException)->setModel(ShopBanner::class, [$banner->id]);
            $others = $active ? $all->filter(fn (ShopBanner $other): bool => $other->active && $other->id !== $locked->id)->values() : collect();

            if ($locked->active === $active && $others->isEmpty()) {
                return $locked;
            }

            foreach ($others as $other) {
                $other->forceFill(['active' => false, 'updated_by' => $staff->id])->save();
            }

            $locked->forceFill(['active' => $active, 'updated_by' => $staff->id])->save();
            $event = $active ? ShopAuditEvent::BannerActivated : ShopAuditEvent::BannerDeactivated;
            Audit::record($event->value, $locked, ['active' => ! $active], ['active' => $active, 'title' => $locked->title, 'deactivated' => array_values($others->pluck('id')->all())], $reason, $staff);

            return $locked;
        });
    }

    public function remove(Staff $staff, ShopBanner $banner, ?string $reason): void
    {
        $files = DB::transaction(function () use ($staff, $banner, $reason): array {
            /** @var ShopBanner $locked */
            $locked = ShopBanner::query()->whereKey($banner->id)->lockForUpdate()->firstOrFail();
            $files = [$locked->variants, $locked->original_path];
            $before = self::snapshot($locked);
            $locked->delete();
            Audit::record(ShopAuditEvent::BannerDeleted->value, $locked, $before, null, $reason, $staff);

            return $files;
        });

        $this->images->delete($files[0], $files[1]);
    }

    /**
     * @return array<string, mixed>
     */
    public static function snapshot(ShopBanner $banner): array
    {
        return [
            'title' => $banner->title,
            'subtitle' => $banner->subtitle,
            'link_kind' => $banner->link_kind->value,
            'product_id' => $banner->shop_product_id,
            'category' => $banner->category?->value,
            'alt' => $banner->alt,
            'focal_x' => $banner->focal_x,
            'focal_y' => $banner->focal_y,
            'active' => $banner->active,
        ];
    }

    /**
     * @param  array<string, mixed>  $data
     * @return array<string, mixed>
     */
    private function clean(array $data, ?ShopBanner $banner): array
    {
        $fields = [];

        foreach (['title', 'subtitle', 'alt'] as $key) {
            if (array_key_exists($key, $data)) {
                $value = is_string($data[$key]) ? trim($data[$key]) : null;
                $fields[$key] = $value === '' ? null : $value;
            }
        }

        $kind = array_key_exists('link_kind', $data) ? ShopBannerLink::from((string) $data['link_kind']) : $banner?->link_kind;

        if ($kind === ShopBannerLink::Product) {
            $fields['link_kind'] = $kind;
            // A missing or empty product_id keeps the stored one (a crafted PATCH must never store '' as the key).
            $fields['shop_product_id'] = is_string($data['product_id'] ?? null) && $data['product_id'] !== '' ? strtolower($data['product_id']) : $banner?->shop_product_id;
            $fields['category'] = null;
        } elseif ($kind === ShopBannerLink::Category) {
            $fields['link_kind'] = $kind;
            $fields['category'] = array_key_exists('category', $data) ? $data['category'] : $banner?->category?->value;
            $fields['shop_product_id'] = null;
        }

        if (array_key_exists('link_kind', $fields) && $fields['link_kind'] === ShopBannerLink::Product && $fields['shop_product_id'] === null) {
            throw ValidationException::withMessages(['product_id' => [(string) __('shop.validation.banner_product')]]);
        }

        if (array_key_exists('link_kind', $fields) && $fields['link_kind'] === ShopBannerLink::Category && $fields['category'] === null) {
            throw ValidationException::withMessages(['category' => [(string) __('shop.validation.banner_category')]]);
        }

        return $fields;
    }
}
