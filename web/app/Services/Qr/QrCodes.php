<?php

namespace App\Services\Qr;

use App\Enums\QrRevocationReason;
use App\Enums\QrStatus;
use App\Models\QrCode;
use App\Models\Vehicle;
use App\Support\Codes;
use Illuminate\Support\Facades\DB;

/**
 * A vehicle has one active code from its first publish on (02_PRODUCT_SPEC §3.4). Rendering is QrRenderer and QrSticker, resolving
 * QrResolver, counting QrScans. The vehicle row lock makes "one active" hold across concurrent calls, since an index cannot express it.
 */
class QrCodes
{
    public function ensureActive(Vehicle $vehicle): QrCode
    {
        return DB::transaction(function () use ($vehicle): QrCode {
            Vehicle::withTrashed()->whereKey($vehicle->getKey())->lockForUpdate()->firstOrFail();

            $active = $vehicle->qrCodes()->where('status', QrStatus::Active)->first();

            if ($active !== null) {
                return $active;
            }

            return Codes::createUnique(function (string $code) use ($vehicle): QrCode {
                $qr = new QrCode(['vehicle_id' => $vehicle->getKey(), 'code' => $code]);
                $qr->forceFill(['status' => QrStatus::Active])->save();

                return $qr;
            });
        });
    }

    /**
     * Revokes every active code, so a scan shows the "nicht mehr gültig" state. Returns how many.
     */
    public function revoke(Vehicle $vehicle, QrRevocationReason $reason): int
    {
        return $vehicle->qrCodes()->where('status', QrStatus::Active)->update([
            'status' => QrStatus::Revoked,
            'revoked_at' => now(),
            'revoked_reason' => $reason,
        ]);
    }

    /**
     * For people: the address as APP_URL spells it.
     */
    public function url(QrCode $qr): string
    {
        return rtrim(config()->string('app.url'), '/').'/C/'.$qr->code;
    }

    /**
     * What the code encodes. Uppercase on purpose: QR alphanumeric mode gives fewer modules and better scans on small stickers
     * (ADR-027). Scheme and host are case-insensitive, and browsers lowercase them. A path in APP_URL is not, so it stays as it is,
     * and the library then falls back to byte mode by itself.
     */
    public function payload(QrCode $qr): string
    {
        $base = rtrim(config()->string('app.url'), '/');
        $path = (string) parse_url($base, PHP_URL_PATH);
        $origin = $path === '' ? $base : substr($base, 0, -strlen($path));

        return strtoupper($origin).$path.'/C/'.$qr->code;
    }

    /**
     * "7H2K QXMB", as FS-9 and the sticker print it.
     */
    public function displayCode(string $code): string
    {
        return trim(chunk_split($code, 4, ' '));
    }
}
