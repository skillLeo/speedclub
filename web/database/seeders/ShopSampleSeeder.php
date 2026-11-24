<?php

namespace Database\Seeders;

use App\Enums\ShopBannerLink;
use App\Enums\ShopCategory;
use App\Enums\ShopPurchaseMode;
use App\Enums\ShopVariantKind;
use App\Enums\StickerSize;
use App\Enums\StickerTemplate;
use App\Models\ShopBanner;
use App\Models\ShopProduct;
use App\Models\ShopProductImage;
use App\Services\Shop\ShopImages;
use App\Services\Stickers\StickerArtwork;
use App\Services\Stickers\StickerCatalogue;
use App\Services\Stickers\StickerContent;
use App\Services\Stickers\StickerInks;
use App\Services\Stickers\StickerLayout;
use App\Services\Stickers\StickerOptions;
use App\Services\Stickers\StickerRaster;
use GdImage;
use Illuminate\Database\Seeder;
use RuntimeException;

/**
 * M5.5 shop samples (m5.5-contract §7), local and staging only, every row is_sample (badged "Beispiel", shown only while
 * editorial_samples is on). No AI image and no invented photo. DQ-P5-002 (design QA P5 r1): each product leads with photographs of the
 * sticker in use: the server's own drawing of a real M5.4 template (placeholder "@deinname", the QR goes to the public home page, never a
 * sticker code, ADR-514) laid at its real size onto one of STK-05's three licensed "am Auto" photos (design/seed-photos, Unsplash
 * License, CREDITS.md): the tinted rear window of an Audi RS3 Sportback 8Y (Swansway Motor Group), the rear window of a Mercedes-AMG
 * A 45 S at dusk (Mathew Antony), the white rear panel of a Nissan 350Z (Pacha Shot's). The plain drawings follow as further images.
 * Everything passes ShopImages (GD re-encode, 4:5 crop, WebP variants, blurhash, private original). Kleidung and Accessoires get no
 * sample: no licensed product photo of either exists.
 *
 * R4DQ-13 (round-4 design review): the hero is a sticker on a car, not office towers. It is drawn like the product shots (HERO: the
 * Classic sticker at its real size on the RS3's tinted rear window; R4DQ-57: the photo's full width at native pixels, 16:9). A host whose
 * sample hero is another picture (staging had cover-night-city-01) gets it replaced on the next run; a banner staff made stays.
 *
 * DQ-P5-040 (design QA P5 r2): a product's first image (the shop tile) is a close crop on the sticker on the car, the sticker about
 * 56 % of the frame's width with the car's surface around it, the wider shot second, then the drawings. The close crop respects the same
 * upscale limit as every shot (3.6× the photo's own pixels): the Round badge (96 mm, about 58 px on the RS3's window) cannot get closer
 * than its wide shot at that limit, so it leads with that shot (the photo region at its native resolution) until a real product photo
 * exists.
 *
 * Runs again safely: a host without samples gets them; a host that has them (staging) gets the images of its sample products replaced
 * when they differ from this list (old files removed), never a product that staff made (is_sample false) or another slug.
 *
 * @phpstan-type Shot array{template: StickerTemplate, options: array<string, mixed>, mockup: string|null, close: bool}
 */
class ShopSampleSeeder extends Seeder
{
    /**
     * R4DQ-13/49/57: the shop hero, the sticker in use (one of MOCKUPS) at its real size. The region is the photo's full width at its
     * native pixels (never scaled up; the RS3's 1600 is the banner minimum width, the A 45 S's 1348 is not), 16:9, ending above the
     * photo's pixelated plate (plates.json); the banner's focal point is the sticker, so every crop keeps it.
     */
    private const HERO = ['template' => StickerTemplate::Classic, 'options' => ['size' => 'l'], 'mockup' => 'day', 'size' => [1600, 900], 'share' => [0.12, 0.2], 'region' => [0, 320, 1600]];

    /** The 4:5 canvas of a sticker drawing, in pixels. */
    private const CANVAS = [1600, 2000];

    /** The 4:5 canvas of a photo of the sticker in use, in pixels (at least speedclub.shop.image.product_min). */
    private const SHOT = [1200, 1500];

    /** The most a shot enlarges the licensed photo's own pixels. */
    private const MAX_UPSCALE = 3.6;

    /**
     * STK-05's "am Auto" photos (mobile/src/features/qr/designer/mockups.ts): the 4:5 crop the app bundles, located on the licensed
     * original (x, y, width, height in pixels of the original), the sticker's spot inside that crop (0–1) and how wide the crop is in
     * real millimetres at the spot, so the sticker is drawn at its real size.
     *
     * @var array<string, array{file: string, crop: array{int, int, int, int}, spot: array{float, float}, mm: int, alt: string}>
     */
    private const MOCKUPS = [
        'day' => ['file' => 'audi-rs3-8y-04.jpg', 'crop' => [608, 328, 992, 1240], 'spot' => [0.677, 0.5], 'mm' => 1631,
            'alt' => 'an der getönten Heckscheibe eines blauen Audi RS3 Sportback'],
        'evening' => ['file' => 'mercedes-w177-03.jpg', 'crop' => [391, 161, 836, 1045], 'spot' => [0.5, 0.5], 'mm' => 1401,
            'alt' => 'an der Heckscheibe eines grauen Mercedes-AMG A 45 S in der Dämmerung'],
        'paint' => ['file' => 'nissan-z33-04.jpg', 'crop' => [608, 688, 992, 1240], 'spot' => [0.613, 0.5], 'mm' => 1364,
            'alt' => 'auf dem weißen Heck eines Nissan 350Z'],
    ];

    public function run(ShopImages $images, StickerLayout $layout, StickerRaster $raster): void
    {
        if (! app()->environment(['local', 'staging', 'testing'])) {
            return;
        }

        $products = $this->products();

        if (ShopProduct::withTrashed()->where('is_sample', true)->exists() || ShopBanner::query()->where('is_sample', true)->exists()) {
            $this->refresh($products, $images, $layout, $raster);
            $this->hero($images, $layout, $raster);

            return;
        }

        $sort = (int) ShopProduct::withTrashed()->max('sort');

        foreach ($products as $data) {
            $product = new ShopProduct;
            $product->forceFill([
                'slug' => $data['slug'],
                'title' => $data['title'],
                'description' => $data['description'],
                'category' => ShopCategory::Sticker,
                'price_cents' => $data['price_cents'],
                'currency' => 'EUR',
                'variant_kind' => ShopVariantKind::Size,
                'variants' => array_map(fn (array $variant, int $index): array => ['id' => sprintf('smpl%04d', $index + 1), ...$variant], $data['variants'], array_keys($data['variants'])),
                'purchase_mode' => $data['mode'],
                'shopify_url' => null,
                'sort' => ++$sort,
                'visible' => true,
                'is_sample' => true,
            ])->save();

            $this->writeImages($product, $data['shots'], $images, $layout, $raster);
        }

        $this->hero($images, $layout, $raster);
    }

    /**
     * @return list<array{slug: string, title: string, description: string, price_cents: int, mode: ShopPurchaseMode, variants: list<array<string, mixed>>, shots: list<Shot>}>
     */
    private function products(): array
    {
        $sizes = array_map(fn (StickerSize $size): array => [
            'label' => $size->label().' · '.self::mm(StickerCatalogue::size(StickerTemplate::Classic, $size)),
            'shopify_variant_id' => null,
        ], StickerSize::cases());
        $shot = fn (StickerTemplate $template, array $options = [], ?string $mockup = null, bool $close = false): array => ['template' => $template, 'options' => $options, 'mockup' => $mockup, 'close' => $close];

        return [
            [
                'slug' => 'car-sticker',
                'title' => 'Car-Sticker – dein Design',
                'description' => "Dein Sticker aus dem Sticker-Designer: sechs Vorlagen, mit oder ohne QR-Code, Benutzername und Autoname.\n\nDu gestaltest ihn in der App, bestellt wird im Online-Shop mit deinem Design. Die Größen gelten für die Vorlage Classic.",
                'price_cents' => 1490,
                'mode' => ShopPurchaseMode::StickerDesigner,
                'variants' => $sizes,
                'shots' => [
                    $shot(StickerTemplate::Plate, ['size' => 'l', 'colourway' => 'black'], 'paint', close: true),
                    $shot(StickerTemplate::Plate, ['size' => 'l', 'colourway' => 'black'], 'paint'),
                    $shot(StickerTemplate::Classic, ['size' => 'l'], 'evening'),
                    $shot(StickerTemplate::Banner, ['size' => 'l', 'username' => true], 'day'),
                    $shot(StickerTemplate::Classic),
                    $shot(StickerTemplate::Minimal),
                    $shot(StickerTemplate::VerticalJdm),
                    $shot(StickerTemplate::Round),
                ],
            ],
            [
                'slug' => 'schriftzug-banner',
                'title' => 'Schriftzug-Banner',
                'description' => 'Der Speedclub Schriftzug als Banner für die Frontscheibe, ohne QR-Code und ohne Namen. Weißer Druck auf transparenter Folie.',
                'price_cents' => 990,
                'mode' => ShopPurchaseMode::Shopify,
                'variants' => [],
                'shots' => [
                    $shot(StickerTemplate::Banner, ['size' => 'l', 'qr' => false, 'username' => false], 'evening', close: true),
                    $shot(StickerTemplate::Banner, ['size' => 'l', 'qr' => false, 'username' => false], 'evening'),
                    $shot(StickerTemplate::Banner, ['qr' => false, 'username' => false]),
                ],
            ],
            [
                'slug' => 'round-badge',
                'title' => 'Round Badge',
                'description' => 'Runder Badge mit QR-Code in der Mitte, weißer Druck mit Signalrot.',
                'price_cents' => 790,
                'mode' => ShopPurchaseMode::Shopify,
                'variants' => [],
                'shots' => [
                    $shot(StickerTemplate::Round, ['size' => 'l', 'username' => false, 'colourway' => 'white_red'], 'day'),
                    $shot(StickerTemplate::Round, ['username' => false, 'colourway' => 'white_red']),
                ],
            ],
        ];
    }

    /**
     * A host that has the samples: each sample product (is_sample, by slug) whose images are not this list's gets them replaced.
     *
     * @param  list<array{slug: string, shots: list<Shot>}>  $products
     */
    private function refresh(array $products, ShopImages $images, StickerLayout $layout, StickerRaster $raster): void
    {
        foreach ($products as $data) {
            $product = ShopProduct::query()->where('slug', $data['slug'])->where('is_sample', true)->first();

            if (! $product instanceof ShopProduct) {
                continue;
            }

            $current = ShopProductImage::query()->where('shop_product_id', $product->id)->orderBy('sort')->pluck('alt')->all();

            if ($current === array_map(fn (array $shot): string => $this->alt($shot), $data['shots'])) {
                continue;
            }

            foreach (ShopProductImage::query()->where('shop_product_id', $product->id)->get() as $old) {
                $variants = array_values(array_map(strval(...), (array) $old->getAttribute('variants')));
                $original = $old->getAttribute('original_path');
                $old->delete();
                $images->delete($variants, is_string($original) ? $original : null);
            }

            $this->writeImages($product, $data['shots'], $images, $layout, $raster);
        }
    }

    /**
     * @param  list<Shot>  $shots
     */
    private function writeImages(ShopProduct $product, array $shots, ShopImages $images, StickerLayout $layout, StickerRaster $raster): void
    {
        foreach ($shots as $index => $shot) {
            $bytes = $shot['mockup'] === null
                ? $this->drawing($layout, $raster, $shot['template'], $shot['options'])
                : $this->inUse($layout, $raster, $shot['template'], $shot['options'], $shot['mockup'], $shot['close']);

            $columns = $images->product($product->id, $bytes, 0.5, 0.5);
            $image = new ShopProductImage;
            $image->forceFill([
                ...$columns,
                'shop_product_id' => $product->id,
                'sort' => $index + 1,
                'alt' => $this->alt($shot),
            ])->save();
        }
    }

    /**
     * @param  Shot  $shot
     */
    private function alt(array $shot): string
    {
        $name = $shot['template']->label('de');

        return match (true) {
            $shot['mockup'] === null => 'Zeichnung der Sticker-Vorlage '.$name.' mit Platzhaltertext',
            $shot['close'] => 'Nahaufnahme: Sticker-Vorlage '.$name.' mit Platzhaltertext '.self::MOCKUPS[$shot['mockup']]['alt'],
            default => 'Sticker-Vorlage '.$name.' mit Platzhaltertext '.self::MOCKUPS[$shot['mockup']]['alt'],
        };
    }

    /**
     * @param  array<string, mixed>  $options
     */
    private function artwork(StickerLayout $layout, StickerTemplate $template, array $options): StickerArtwork
    {
        $stickerOptions = StickerOptions::fromArray($template, $options);
        $url = rtrim(config()->string('app.url'), '/').'/';

        return $layout->build($stickerOptions, new StickerContent($stickerOptions->qr ? $url : null, 'deinname', 'Dein Auto', null));
    }

    /**
     * DQ-P5-002: the sticker in use, a JPEG of SHOT size. The licensed photo is cropped 4:5 around STK-05's spot, framed so the sticker
     * reads (about 40 % of the width, never more than half the height; DQ-P5-040's close crop: about 56 % and 60 %; always at most
     * MAX_UPSCALE× the photo's own pixels) and drawn at its real size against the photo's millimetres; inks only (print mode, the
     * transparent vinyl), seen from outside the car (never mirrored). R4DQ-13: the hero passes its own size and shares (a wider frame).
     *
     * @param  array<string, mixed>  $options
     * @param  array{int<1, max>, int<1, max>}|null  $size  output width and height (default SHOT)
     * @param  array{float, float}|null  $share  the sticker's share of the width and the height
     * @param  array{int, int, int}|null  $region  a fixed region of the photo (left, top, width in its pixels; the height follows the
     *                                             output's ratio), R4DQ-49: the hero's ends above the photo's pixelated plate
     */
    private function inUse(StickerLayout $layout, StickerRaster $raster, StickerTemplate $template, array $options, string $mockup, bool $close = false, ?array $size = null, ?array $share = null, ?array $region = null): string
    {
        $spec = self::MOCKUPS[$mockup];
        $path = base_path('../design/seed-photos/'.$spec['file']);
        $photo = is_file($path) ? @imagecreatefromjpeg($path) : false;

        if (! $photo instanceof GdImage) {
            throw new RuntimeException('design/seed-photos/'.$spec['file'].' is missing: the shop sample cannot show the sticker in use.');
        }

        $artwork = $this->artwork($layout, $template, ['mirrored' => false, ...$options]);
        [$cropX, $cropY, $cropW, $cropH] = $spec['crop'];
        $pxPerMm = $cropW / $spec['mm'];
        $spotX = $cropX + $spec['spot'][0] * $cropW;
        $spotY = $cropY + $spec['spot'][1] * $cropH;
        [$outW, $outH] = $size ?? self::SHOT;
        $photoW = imagesx($photo);
        $photoH = imagesy($photo);

        // The region of the photo that becomes the shot: wide enough for the sticker to read, never upscaled more than MAX_UPSCALE×.
        [$widthShare, $heightShare] = $share ?? ($close ? [0.56, 0.6] : [0.4, 0.5]);
        $regionW = max($artwork->width * $pxPerMm / $widthShare, $artwork->height * $pxPerMm / $heightShare * $outW / $outH, $outW / self::MAX_UPSCALE);
        $regionW = min($regionW, $photoW, $photoH * $outW / $outH);
        $regionH = $regionW * $outH / $outW;
        $left = (int) round(min(max(0.0, $spotX - $regionW / 2), $photoW - $regionW));
        $top = (int) round(min(max(0.0, $spotY - $regionH / 2), $photoH - $regionH));

        if ($region !== null) {
            [$left, $top, $fixedW] = $region;
            $regionW = (float) min($fixedW, $photoW - $left);
            $regionH = $regionW * $outH / $outW;
        }

        $canvas = imagecreatetruecolor($outW, $outH);

        if (! $canvas instanceof GdImage) {
            throw new RuntimeException('GD could not create the shop sample canvas.');
        }

        imagecopyresampled($canvas, $photo, 0, 0, $left, $top, $outW, $outH, (int) round($regionW), (int) round($regionH));
        $scale = $outW / $regionW;
        $sticker = $raster->render($artwork, $pxPerMm * $scale, 'print');
        imagealphablending($canvas, true);
        imagecopy($canvas, $sticker, (int) round(($spotX - $left) * $scale - imagesx($sticker) / 2), (int) round(($spotY - $top) * $scale - imagesy($sticker) / 2), 0, 0, imagesx($sticker), imagesy($sticker));

        ob_start();
        imagejpeg($canvas, null, 92);

        return (string) ob_get_clean();
    }

    /**
     * The sticker as the camera sees it on its surface, centred on a 4:5 canvas of that surface (at least 80 % of the width or 70 % of
     * the height, DQ-P5-002): PNG bytes.
     *
     * @param  array<string, mixed>  $options
     */
    private function drawing(StickerLayout $layout, StickerRaster $raster, StickerTemplate $template, array $options): string
    {
        $artwork = $this->artwork($layout, $template, $options);
        $stickerOptions = StickerOptions::fromArray($template, $options);
        [$width, $height] = self::CANVAS;
        $pxPerMm = min($width * 0.8 / $artwork->width, $height * 0.7 / $artwork->height);
        $sticker = $raster->render($artwork, $pxPerMm, 'seen');
        $canvas = imagecreatetruecolor($width, $height);

        if (! $canvas instanceof GdImage) {
            throw new RuntimeException('GD could not create the shop sample canvas.');
        }

        [$r, $g, $b] = StickerInks::surface($stickerOptions->colourway);
        imagefilledrectangle($canvas, 0, 0, $width, $height, (int) imagecolorallocate($canvas, max(0, min(255, $r)), max(0, min(255, $g)), max(0, min(255, $b))));
        imagecopy($canvas, $sticker, (int) (($width - imagesx($sticker)) / 2), (int) (($height - imagesy($sticker)) / 2), 0, 0, imagesx($sticker), imagesy($sticker));

        return $raster->png($canvas);
    }

    private function hero(ShopImages $images, StickerLayout $layout, StickerRaster $raster): void
    {
        $alt = 'Sticker-Vorlage '.self::HERO['template']->label('de').' mit Platzhaltertext '.self::MOCKUPS[self::HERO['mockup']]['alt'];
        $current = ShopBanner::query()->where('is_sample', true)->get();

        try {
            $bytes = $this->inUse($layout, $raster, self::HERO['template'], self::HERO['options'], self::HERO['mockup'], false, self::HERO['size'], self::HERO['share'], self::HERO['region']);
        } catch (RuntimeException $exception) {
            $this->command?->warn($exception->getMessage().' The shop sample has no hero.');

            return;
        }

        // Idempotent: the sample hero drawn from exactly these bytes stays; an older sample hero (another photo, or the R4DQ-13 frame
        // that still showed the pixelated plate, R4DQ-49) is replaced.
        if ($current->contains(fn (ShopBanner $banner): bool => $banner->alt === $alt && $banner->getAttribute('sha256') === hash('sha256', $bytes))) {
            return;
        }

        $spec = self::MOCKUPS[self::HERO['mockup']];
        [$left, $top, $width] = self::HERO['region'];
        $height = $width * self::HERO['size'][1] / self::HERO['size'][0];
        $focalX = ($spec['crop'][0] + $spec['spot'][0] * $spec['crop'][2] - $left) / $width;
        $focalY = ($spec['crop'][1] + $spec['spot'][1] * $spec['crop'][3] - $top) / $height;
        $columns = $images->banner($bytes, $focalX, $focalY);

        foreach ($current as $old) {
            $variants = array_values(array_map(strval(...), (array) $old->getAttribute('variants')));
            $original = $old->getAttribute('original_path');
            $old->delete();
            $images->delete($variants, is_string($original) ? $original : null);
        }

        $banner = new ShopBanner;
        $banner->forceFill([
            ...$columns,
            'title' => 'Dein Build. Dein Sticker.',
            'subtitle' => 'Gestalte ihn in der App, bestell ihn im Shop.',
            'link_kind' => ShopBannerLink::Category,
            'category' => ShopCategory::Sticker,
            'shop_product_id' => null,
            'alt' => $alt,
            // The composite has no ThumbHash of its own (the manifest's is of the whole photo): the client takes its blurhash.
            'thumbhash' => null,
            'active' => true,
            'is_sample' => true,
        ])->save();
    }

    /**
     * @param  array{width: float, height: float}  $size
     */
    private static function mm(array $size): string
    {
        $format = fn (float $value): string => rtrim(rtrim(number_format($value, 1, ',', ''), '0'), ',');

        return $format($size['width']).' × '.$format($size['height']).' mm';
    }
}
