<?php

namespace App\Actions\Admin\Stickers;

use App\Actions\Stickers\RequestStickerOrderLink;
use App\Models\Staff;
use App\Models\StickerDesign;
use App\Services\Audit\Audit;
use App\Services\Stickers\StickerFiles;
use Illuminate\Http\Response;

/**
 * The print partner's download (m5.4-contract §8): the same print file the owner gets, for a validated version whose code still works
 * (409 otherwise, so a dead sticker is never printed). Audited with the design and the format, nothing else.
 */
class DownloadStickerPrintFile
{
    public const EVENT = 'sticker.print_downloaded';

    public function __construct(private readonly StickerFiles $files) {}

    /**
     * @param  'pdf'|'svg'  $format
     */
    public function handle(Staff $staff, StickerDesign $design, string $format): Response
    {
        // Admin pages answer with their own error page, not the API's JSON.
        $refusal = RequestStickerOrderLink::printRefusal($design);
        abort_if($refusal !== null, 409, $refusal?->message() ?? '');
        $vehicle = $design->vehicle;
        abort_if($vehicle === null, 404);

        $body = $format === 'pdf' ? $this->files->printPdf($design, $vehicle) : $this->files->printSvg($design, $vehicle);

        Audit::record(self::EVENT, $design, null, ['reference' => $design->reference, 'version' => $design->version, 'format' => $format], null, $staff);

        return new Response($body, 200, [
            'Content-Type' => $format === 'pdf' ? 'application/pdf' : 'image/svg+xml',
            'Content-Disposition' => 'attachment; filename="speedclub-sticker-'.$design->reference.'-v'.$design->version.'.'.$format.'"',
            'Cache-Control' => 'private, no-store',
            'X-Content-Type-Options' => 'nosniff',
        ]);
    }
}
