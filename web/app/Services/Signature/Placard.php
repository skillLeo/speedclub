<?php

namespace App\Services\Signature;

use App\Enums\ModStatus;
use App\Enums\PowerDisplay;
use App\Models\Modification;
use App\Models\QrCode;
use App\Models\Vehicle;
use App\Services\Garage\ModPresenter;
use App\Services\Garage\VehiclePresenter;
use App\Services\Media\MediaService;
use App\Services\Qr\QrCodes;
use App\Services\Qr\QrRenderer;
use App\Support\Viewer;
use Barryvdh\DomPDF\PDF;
use GdImage;
use Illuminate\Support\Facades\File;

/**
 * The car-show placard [SIG sig.placard_pdf] (02_PRODUCT_SPEC §5, m2.7-contract §1): a build sheet, A5 or A4 portrait, with the cover photo,
 * the title, the Technik tables, the top mods per category, the QR code with its short code and the logo beside it, in the owner's language
 * and power unit, fonts embedded.
 *
 * dompdf runs with remote access off and a chroot of only the bundled fonts, their metrics cache and the brand folder (SEC-P1-11): the photo
 * and the code are handed in as data URIs, so nothing else on the host can end up in a PDF, whatever a template or a value held.
 */
final class Placard
{
    /** @var list<array{family: string, weight: string, variant: string, file: string}> */
    private const FONTS = [
        ['family' => 'Inter', 'weight' => '400', 'variant' => 'normal', 'file' => 'Inter-Regular.ttf'],
        ['family' => 'Inter', 'weight' => '700', 'variant' => 'bold', 'file' => 'Inter-SemiBold.ttf'],
        ['family' => 'Barlow Semi Condensed', 'weight' => '700', 'variant' => 'bold', 'file' => 'BarlowSemiCondensed-Bold.ttf'],
    ];

    /** The photo band of the sheet, width to height: 130 × 44 mm on A5, the same shape on A4. */
    private const PHOTO_RATIO = 130 / 44;

    /** Rows the title above already says. */
    private const TITLE_ROWS = ['make', 'model', 'generation'];

    /** Mods shown per category: the build sheet is one page. */
    private const MODS_PER_CATEGORY = 2;

    private const CATEGORIES = 6;

    public function __construct(
        private readonly VehiclePresenter $presenter,
        private readonly ModPresenter $mods,
        private readonly MediaService $media,
        private readonly QrCodes $codes,
        private readonly QrRenderer $renderer,
    ) {}

    /**
     * The only places dompdf may read from.
     *
     * @return list<string>
     */
    public static function chroot(): array
    {
        return [resource_path('fonts'), storage_path('fonts'), public_path('brand')];
    }

    /**
     * Remote access, PHP and JavaScript off; reading only inside chroot().
     */
    public function configure(PDF $pdf): PDF
    {
        $pdf->setOption('isRemoteEnabled', false);
        $pdf->setOption('isPhpEnabled', false);
        $pdf->setOption('isJavascriptEnabled', false);
        $pdf->setOption('chroot', self::chroot());
        $pdf->setOption('isFontSubsettingEnabled', true);

        return $pdf;
    }

    public function pdf(Vehicle $vehicle, QrCode $qr, string $size): string
    {
        File::ensureDirectoryExists(storage_path('fonts'));

        /** @var PDF $pdf */
        $pdf = $this->configure(app('dompdf.wrapper'));
        $this->registerFonts($pdf);

        $pdf->loadView('pdf.placard', $this->viewData($vehicle, $qr, $size));
        $pdf->setPaper($size, 'portrait');
        $pdf->addInfo(['Title' => 'SPEED CLUB '.$this->presenter->fullTitle($vehicle), 'Creator' => 'SPEED CLUB', 'Producer' => 'SPEED CLUB']);

        return $pdf->output();
    }

    /**
     * @return array<string, mixed>
     */
    public function viewData(Vehicle $vehicle, QrCode $qr, string $size): array
    {
        $locale = app()->getLocale();
        $owner = $vehicle->owner;
        $display = Viewer::powerDisplay($owner);
        $installed = $vehicle->modifications
            ->filter(fn (Modification $mod): bool => $mod->getAttribute('status') === ModStatus::Installed)
            ->sortBy([['sort', 'asc'], ['id', 'asc']]);
        $groups = [];

        foreach ($installed->groupBy('category_id')->sortBy(fn ($group): mixed => $group->first()?->category->getAttribute('sort')) as $group) {
            /** @var Modification $first */
            $first = $group->first();
            $groups[] = [
                'name' => (string) $first->category->getTranslation('name', $locale),
                'items' => $group->take(self::MODS_PER_CATEGORY)->map(fn (Modification $mod): string => $this->mods->summaryLine(
                    (string) $mod->getAttribute('title'),
                    $mod->category,
                    $mod->getAttribute('fields') ?? [],
                    $locale,
                ))->values()->all(),
                'more' => max(0, $group->count() - self::MODS_PER_CATEGORY),
            ];
        }

        $cover = $this->presenter->cover($vehicle, false);
        $photo = $cover === null ? null : $this->media->largestVariant($cover);

        return [
            'size' => $size,
            'photo' => $photo === null ? null : $this->jpegDataUri($photo, $cover->getAttribute('focal_x'), $cover->getAttribute('focal_y')),
            'eyebrow' => $this->presenter->eyebrow($vehicle),
            'title' => $this->presenter->title($vehicle),
            'subline' => implode(' · ', $this->presenter->subline($vehicle, $locale)),
            'spec_groups' => $this->specGroups($vehicle, $display, $locale),
            'mod_groups' => array_slice($groups, 0, self::CATEGORIES),
            'more_categories' => max(0, count($groups) - self::CATEGORIES),
            // ADR-148 a: the placard stands next to the car, as the sticker does.
            'username' => $owner?->getAttribute('show_owner_on_qr') === false ? null : $owner?->username,
            'qr_image' => 'data:image/png;base64,'.base64_encode($this->renderer->png($this->codes->payload($qr), 1024)),
            'code' => $this->codes->displayCode($qr->code),
            'url' => $this->codes->url($qr),
            'logo' => public_path('brand/logo-wide-black-640.png'),
        ];
    }

    /**
     * The Technik tables without the rows the title already holds, so the sheet stays one page.
     *
     * @return list<array{key: string, label: string, rows: list<array{key: string, label: string, value: string, source: string|null, source_label: string|null}>}>
     */
    private function specGroups(Vehicle $vehicle, PowerDisplay $display, string $locale): array
    {
        $groups = [];

        foreach ($this->presenter->specGroups($vehicle, $display, $locale) as $group) {
            $group['rows'] = array_values(array_filter($group['rows'], fn (array $row): bool => ! in_array($row['key'], self::TITLE_ROWS, true)));

            if ($group['rows'] !== []) {
                $groups[] = $group;
            }
        }

        return $groups;
    }

    /**
     * The WebP variant as a JPEG cut to the photo band around the focal point, as the pages crop (03_DESIGN_SYSTEM §7): dompdf decodes JPEG
     * everywhere, and a data URI needs no file access.
     */
    private function jpegDataUri(string $bytes, mixed $focalX, mixed $focalY): ?string
    {
        $source = @imagecreatefromstring($bytes);

        if (! $source instanceof GdImage) {
            return null;
        }

        $width = imagesx($source);
        $height = imagesy($source);
        $cropWidth = max(1, min($width, (int) round($height * self::PHOTO_RATIO)));
        $cropHeight = max(1, min($height, (int) round($width / self::PHOTO_RATIO)));
        $x = (int) round($width * (is_numeric($focalX) ? (float) $focalX : 0.5) - $cropWidth / 2);
        $y = (int) round($height * (is_numeric($focalY) ? (float) $focalY : 0.5) - $cropHeight / 2);
        $image = imagecreatetruecolor($cropWidth, $cropHeight);

        if (! $image instanceof GdImage) {
            return null;
        }

        imagecopy($image, $source, 0, 0, max(0, min($x, $width - $cropWidth)), max(0, min($y, $height - $cropHeight)), $cropWidth, $cropHeight);

        ob_start();
        imagejpeg($image, null, 85);

        return 'data:image/jpeg;base64,'.base64_encode((string) ob_get_clean());
    }

    /**
     * Registered once, as for the sticker sheet (QrSticker): parsing a TTF takes seconds.
     */
    private function registerFonts(PDF $pdf): void
    {
        $metrics = $pdf->getDomPDF()->getFontMetrics();
        $families = $metrics->getFontFamilies();

        foreach (self::FONTS as $font) {
            $installed = $families[mb_strtolower($font['family'])][$font['variant']] ?? null;

            if (! is_string($installed) || ! is_file($installed.'.ufm')) {
                $metrics->registerFont(
                    ['family' => $font['family'], 'weight' => $font['weight'], 'style' => 'normal'],
                    resource_path('fonts/'.$font['file']),
                );
            }
        }
    }
}
