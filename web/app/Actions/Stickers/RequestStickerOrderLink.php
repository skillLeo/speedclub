<?php

namespace App\Actions\Stickers;

use App\Enums\ErrorCode;
use App\Enums\QrStatus;
use App\Exceptions\ApiException;
use App\Models\StickerDesign;
use App\Models\Vehicle;
use App\Services\Stickers\StickerOrderLink;

/**
 * STK-06 (m5.4-contract §7): the Shopify link for a validated design whose code still works. Records when the owner last asked for it;
 * whether Shopify completed an order is never known here.
 */
class RequestStickerOrderLink
{
    public function __construct(private readonly StickerOrderLink $links) {}

    public function handle(StickerDesign $design, Vehicle $vehicle): ?string
    {
        self::assertPrintable($design);

        $url = $this->links->url($design, $vehicle);

        if ($url !== null) {
            $design->forceFill(['order_requested_at' => now()])->save();
        }

        return $url;
    }

    /**
     * A print needs the Scan-Test passed (or no code at all) and, with a code, that code still active: a revoked one would print a
     * sticker that says "nicht mehr gültig".
     */
    public static function assertPrintable(StickerDesign $design): void
    {
        $refusal = self::printRefusal($design);

        if ($refusal !== null) {
            throw new ApiException($refusal);
        }
    }

    /**
     * Why the design cannot be printed, or null when it can.
     */
    public static function printRefusal(StickerDesign $design): ?ErrorCode
    {
        return match (true) {
            ! $design->isValidated() => ErrorCode::StickerNotValidated,
            $design->stickerOptions()->qr && $design->qrCode?->status !== QrStatus::Active => ErrorCode::StickerCodeReplaced,
            default => null,
        };
    }
}
