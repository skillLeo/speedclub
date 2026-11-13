<?php

namespace App\Services\Qr;

use App\Models\QrCode;
use App\Services\Pdf\PdfFonts;
use Barryvdh\DomPDF\PDF;
use FontLib\Font;
use FontLib\TrueType\File as TrueType;
use Illuminate\Support\Facades\File;
use RuntimeException;

/**
 * The A6 sticker sheet of QR-02: the logo beside the code, never inside it (02_PRODUCT_SPEC §3.4). Fonts are registered once per host
 * (PdfFonts): dompdf parses a TTF on every registerFont call, and that takes seconds.
 */
class QrSticker
{
    /** @var list<array{family: string, weight: string, variant: string, file: string}> */
    private const FONTS = [
        ['family' => 'Inter', 'weight' => '400', 'variant' => 'normal', 'file' => 'Inter-Regular.ttf'],
        ['family' => 'Inter', 'weight' => '700', 'variant' => 'bold', 'file' => 'Inter-SemiBold.ttf'],
        ['family' => 'Inter Display', 'weight' => '600', 'variant' => '600', 'file' => 'InterDisplay-SemiBold.ttf'],
    ];

    /** People speak Inter (09 §4.2): the handle in Inter Display 600, the cut of title.1. */
    private const USERNAME_FONT = 'InterDisplay-SemiBold.ttf';

    private const USERNAME_SIZE_PT = 22;

    /** What the sheet leaves between its 8 mm margins: 105 mm less 16 mm. */
    private const TEXT_WIDTH_PT = 252.3;

    public function __construct(
        private readonly QrCodes $codes,
        private readonly QrRenderer $renderer,
    ) {}

    public function pdf(QrCode $qr): string
    {
        File::ensureDirectoryExists(storage_path('fonts'));

        /** @var PDF $pdf */
        $pdf = app('dompdf.wrapper');
        $pdf->setOption('isFontSubsettingEnabled', true);
        PdfFonts::register($pdf, self::FONTS);

        $pdf->loadView('pdf.qr-sticker', $this->viewData($qr));
        $pdf->setPaper('a6', 'portrait');
        $pdf->addInfo(['Title' => 'SPEED CLUB QR-Sticker '.$this->codes->displayCode($qr->code), 'Creator' => 'SPEED CLUB', 'Producer' => 'SPEED CLUB']);

        return $pdf->output();
    }

    /**
     * No @username when the owner asked not to be named on the page the sticker leads to: the sticker sits on the car itself.
     *
     * @return array{qr_image: string, logo: string, username: string|null, username_size: int, code: string, url: string}
     */
    public function viewData(QrCode $qr): array
    {
        $owner = $qr->vehicle?->owner;
        $username = $owner?->getAttribute('show_owner_on_qr') === false ? null : $owner?->username;

        return [
            'qr_image' => 'data:image/png;base64,'.base64_encode($this->renderer->png($this->codes->payload($qr), 2048)),
            'logo' => public_path('brand/logo-wide-black-640.png'),
            'username' => $username,
            'username_size' => $username === null ? self::USERNAME_SIZE_PT : $this->usernameSize('@'.$username),
            'code' => $this->codes->displayCode($qr->code),
            'url' => $this->codes->url($qr),
        ];
    }

    /**
     * The printed handle is always whole: a name near the 24-character limit with wide letters shrinks, as dompdf neither wraps it on
     * one page nor breaks it inside the word. About 11 pt at worst (24 m in Inter Display), and the line height stays, so the sheet does not move.
     */
    private function usernameSize(string $handle): int
    {
        $width = $this->widthAtFullSize($handle);

        return $width <= self::TEXT_WIDTH_PT
            ? self::USERNAME_SIZE_PT
            : (int) floor(self::USERNAME_SIZE_PT * self::TEXT_WIDTH_PT / $width);
    }

    /**
     * From the font's own advances, without a PDF and without GD, which rounds to whole pixels.
     */
    private function widthAtFullSize(string $text): float
    {
        $font = Font::load(resource_path('fonts/'.self::USERNAME_FONT));

        if (! $font instanceof TrueType) {
            throw new RuntimeException('The sticker font cannot be read.');
        }

        $font->parse();
        /** @var array<int, int> $glyphs */
        $glyphs = $font->getUnicodeCharMap();
        /** @var array<int, array{0: int, 1: int}> $advances */
        $advances = $font->getData('hmtx');
        /** @var int $unitsPerEm */
        $unitsPerEm = $font->getData('head', 'unitsPerEm');
        $units = 0;

        foreach (mb_str_split($text) as $character) {
            $units += $advances[$glyphs[mb_ord($character)] ?? 0][0];
        }

        $font->close();

        return $units * self::USERNAME_SIZE_PT / $unitsPerEm;
    }
}
