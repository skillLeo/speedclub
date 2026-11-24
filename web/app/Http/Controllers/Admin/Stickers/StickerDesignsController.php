<?php

namespace App\Http\Controllers\Admin\Stickers;

use App\Actions\Admin\Stickers\DownloadStickerPrintFile;
use App\Http\Controllers\Admin\Support\TableProps;
use App\Http\Controllers\Controller;
use App\Models\Staff;
use App\Services\Stickers\StickerAdminRows;
use Illuminate\Http\Request;
use Illuminate\Http\Response;
use Inertia\Inertia;
use Inertia\Response as InertiaResponse;

/**
 * ADM "Sticker-Designs" (10 §2.3, m5.4-contract §8): every design version with its state and, for validated versions whose code still
 * works, the print files the print partner downloads by design id (`SD…`). Atom `stickers.print`; every download is audited.
 */
class StickerDesignsController extends Controller
{
    public const TABLE = 'sticker_designs';

    public const DEFAULT_SORT = '-order_requested_at';

    public function index(Request $request, StickerAdminRows $rows): InertiaResponse
    {
        /** @var Staff $staff */
        $staff = $request->user('staff');

        return Inertia::render('Stickers/Designs/Index', TableProps::make($rows->query($request, self::DEFAULT_SORT), $request, self::TABLE, $staff, $rows->map(...), self::DEFAULT_SORT));
    }

    public function printPdf(Request $request, string $design, DownloadStickerPrintFile $download): Response
    {
        /** @var Staff $staff */
        $staff = $request->user('staff');

        return $download->handle($staff, StickerAdminRows::find($design), 'pdf');
    }

    public function printSvg(Request $request, string $design, DownloadStickerPrintFile $download): Response
    {
        /** @var Staff $staff */
        $staff = $request->user('staff');

        return $download->handle($staff, StickerAdminRows::find($design), 'svg');
    }
}
