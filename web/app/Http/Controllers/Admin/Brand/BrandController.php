<?php

namespace App\Http\Controllers\Admin\Brand;

use App\Actions\Admin\Brand\MeasureHeroContrast;
use App\Actions\Admin\Brand\UploadBrandAsset;
use App\Enums\BrandAssetKind;
use App\Enums\ConfigKey;
use App\Enums\ThemePreference;
use App\Http\Controllers\Admin\Brand\Requests\ContrastRequest;
use App\Http\Controllers\Admin\Brand\Requests\UploadBrandAssetRequest;
use App\Http\Controllers\Admin\Config\Support\ConfigEditor;
use App\Http\Controllers\Controller;
use App\Models\BrandAsset;
use App\Models\Staff;
use App\Services\Brand\AccentSets;
use App\Services\Brand\BrandAssets;
use App\Services\Config\Schemas\BrandingSchema;
use Illuminate\Http\JsonResponse;
use Illuminate\Http\RedirectResponse;
use Illuminate\Http\Request;
use Illuminate\Http\UploadedFile;
use Inertia\Inertia;
use Inertia\Response;

/**
 * ADM-28 Marke & Theme (06 §3, 03 §2/§3, FS-1 / BL-4): the branding draft (logo set, heroes with focal point, OG default, accent set from
 * the pre-validated palette, default theme), the uploaded brand images to choose from, and the live contrast check of a hero at a focal
 * point. Publishing and rollback go through ConfigDraftController (key branding).
 */
class BrandController extends Controller
{
    /** How many uploaded images the page offers per kind (newest first); older ones stay in the store for rollbacks. */
    private const ASSETS_PER_KIND = 12;

    public function index(Request $request, ConfigEditor $editor, AccentSets $accents, BrandAssets $files, BrandingSchema $schema): Response
    {
        /** @var Staff $staff */
        $staff = $request->user('staff');

        $assets = [];
        foreach (BrandAssetKind::cases() as $kind) {
            $rows = BrandAsset::query()->with('uploader:id,name')->where('kind', $kind)->latest()->orderByDesc('id')->limit(self::ASSETS_PER_KIND)->get();
            foreach ($rows as $asset) {
                $assets[] = [
                    'id' => $asset->id,
                    'kind' => $kind->value,
                    'url' => $files->path($asset, $kind->isLogo() ? 640 : 1080),
                    'thumb' => $files->path($asset, 320),
                    'width' => $asset->width,
                    'height' => $asset->height,
                    'bytes' => $asset->bytes,
                    'uploaded_at' => $asset->created_at?->toIso8601String(),
                    'uploaded_by' => $asset->uploader?->getAttribute('name'),
                ];
            }
        }

        $props = $editor->props(ConfigKey::Branding, $staff);
        // A version published before ADM-28 (the bundled paths of the first install) has no logo set or hero slots yet: the form
        // starts from every slot of the schema, filled from that version.
        $initial = $schema->initial();
        $payload = $props['payload'];
        $props['payload'] = [
            ...$initial,
            ...$payload,
            'logos' => [...$initial['logos'], ...(is_array($payload['logos'] ?? null) ? $payload['logos'] : [])],
            'heroes' => [...$initial['heroes'], ...(is_array($payload['heroes'] ?? null) ? $payload['heroes'] : [])],
            'accent_set' => $accents->resolve($payload['accent_set'] ?? null) ?? $accents->defaultKey(),
        ];

        return Inertia::render('Brand/Index', [
            'editor' => $props,
            'assets' => $assets,
            'accentSets' => $accents->keys(),
            'defaultAccent' => $accents->defaultKey(),
            'themes' => array_map(fn (ThemePreference $theme): string => $theme->value, ThemePreference::cases()),
            'minimums' => array_combine(
                array_map(fn (BrandAssetKind $kind): string => $kind->value, BrandAssetKind::cases()),
                array_map(fn (BrandAssetKind $kind): array => ['width' => $kind->minimum()[0], 'height' => $kind->minimum()[1]], BrandAssetKind::cases()),
            ),
            'maxUploadKb' => config()->integer('speedclub.brand.max_upload_kb'),
        ]);
    }

    public function upload(UploadBrandAssetRequest $request, UploadBrandAsset $upload): RedirectResponse
    {
        $file = $request->file('file');
        abort_unless($file instanceof UploadedFile, 422);

        $upload->handle(
            $request->staff(),
            BrandAssetKind::from($request->string('kind')->value()),
            $file,
            $request->filled('focal_x') ? (float) $request->input('focal_x') : 0.5,
            $request->filled('focal_y') ? (float) $request->input('focal_y') : 0.5,
        );

        return back(303)->with('success', 'brand.flash.uploaded');
    }

    public function contrast(ContrastRequest $request, string $asset, MeasureHeroContrast $measure): JsonResponse
    {
        $row = BrandAsset::query()->find($asset);
        abort_if($row === null, 404);

        // A3: the background contrast check lands between a save and the page that shows its toast; it must not age the flash.
        if ($request->hasSession()) {
            $request->session()->reflash();
        }
        $result = $measure->handle($request->staff(), $row, (float) $request->input('focal_x'), (float) $request->input('focal_y'));

        return response()->json($result->toArray());
    }
}
