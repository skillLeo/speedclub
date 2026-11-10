<?php

namespace App\Actions\Admin\Brand;

use App\Enums\BrandAssetKind;
use App\Models\BrandAsset;
use App\Models\Staff;
use App\Services\Admin\Members\StaffAtoms;
use App\Services\Brand\HeroContrast;
use App\Services\Brand\HeroContrastResult;
use Illuminate\Auth\Access\AuthorizationException;
use Illuminate\Validation\ValidationException;

/**
 * ADM-28 focal point (BL-4): the contrast of a hero at a focal point x/y (0–1), for the page while the editor clicks. A read; the
 * same check refuses the branding draft (BrandingSchema).
 */
final class MeasureHeroContrast
{
    public function __construct(private readonly HeroContrast $contrast) {}

    /**
     * @throws AuthorizationException|ValidationException
     */
    public function handle(Staff $staff, BrandAsset $asset, float $focalX, float $focalY): HeroContrastResult
    {
        StaffAtoms::ensure($staff, 'brand.manage');

        if ($asset->kind !== BrandAssetKind::Hero) {
            throw ValidationException::withMessages(['asset_id' => [(string) __('content.brand.asset_kind')]]);
        }

        if ($focalX < 0 || $focalX > 1 || $focalY < 0 || $focalY > 1) {
            throw ValidationException::withMessages(['focal_x' => [(string) __('content.brand.focal')]]);
        }

        return $this->contrast->forAsset($asset, $focalX, $focalY);
    }
}
