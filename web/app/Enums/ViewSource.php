<?php

namespace App\Enums;

use App\Support\Enums\HasLabel;
use Illuminate\Http\Request;

/**
 * M5.7 (10 §6.1): where a counted view came from: App, Web, Sticker-Scan, geteilter Link. The first counted view of a viewer, subject and
 * day decides; INS-01 shows the 30-day split ("Top-Quellen"). Never a referrer, a site or a person.
 */
enum ViewSource: string
{
    use HasLabel;

    case App = 'app';
    case Web = 'web';
    case StickerScan = 'sticker_scan';
    case SharedLink = 'shared_link';

    /** The `via` query value of share links (`share_url` of vehicles and profiles, m5.7-contract §2.4). */
    public const SHARE_PARAMETER = 'share';

    /**
     * A public page (WEB-01, WEB-02) opened through a shared link (`?via=share`) or otherwise on the web.
     */
    public static function fromShareParameter(Request $request): self
    {
        return $request->query('via') === self::SHARE_PARAMETER ? self::SharedLink : self::Web;
    }
}
