<?php

namespace App\Actions\Admin\Brand;

use App\Enums\BrandAssetKind;
use App\Enums\ContentEvent;
use App\Models\BrandAsset;
use App\Models\Staff;
use App\Services\Admin\Members\StaffAtoms;
use App\Services\Audit\Audit;
use App\Services\Brand\BrandAssets;
use App\Services\Brand\HeroContrast;
use App\Services\Brand\HeroContrastResult;
use Illuminate\Auth\Access\AuthorizationException;
use Illuminate\Http\UploadedFile;
use Illuminate\Validation\ValidationException;

/**
 * ADM-28 upload (`brand.manage`): a logo, hero or OG image through BrandAssets (type by content, size and pixel limits, re-encode, EXIF
 * gone, WebP variants). Uploading changes nothing live: the asset is chosen in the branding draft (SaveConfigDraft) and published from
 * there. A hero comes back with its contrast at the focal point it was uploaded with (centre by default), so the page can show it before
 * the draft refuses it. Audited as `brand.asset_uploaded` (kind, size, dimensions, hash; never the file).
 */
final class UploadBrandAsset
{
    public function __construct(private readonly BrandAssets $assets, private readonly HeroContrast $contrast) {}

    /**
     * @return array{asset: BrandAsset, contrast: HeroContrastResult|null}
     *
     * @throws AuthorizationException|ValidationException
     */
    public function handle(Staff $staff, BrandAssetKind $kind, UploadedFile $file, float $focalX = 0.5, float $focalY = 0.5): array
    {
        StaffAtoms::ensure($staff, 'brand.manage');

        $asset = $this->assets->store($file, $kind, $staff);
        $contrast = $kind === BrandAssetKind::Hero ? $this->contrast->forAsset($asset, $focalX, $focalY) : null;

        Audit::record(ContentEvent::BrandAssetUploaded->value, $asset, after: [
            'kind' => $kind->value,
            'width' => $asset->width,
            'height' => $asset->height,
            'bytes' => $asset->bytes,
            'sha256' => $asset->sha256,
            'contrast' => $contrast?->toArray(),
        ], actor: $staff);

        return ['asset' => $asset, 'contrast' => $contrast];
    }
}
