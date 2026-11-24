<?php

namespace App\Http\Resources\V1;

use App\Models\EventCheckinCode;
use App\Services\Events\EventCheckins;
use Illuminate\Http\Request;
use Illuminate\Http\Resources\Json\JsonResource;

/**
 * M5.6 EVT-06 "Check-in-Code zeigen" (m5.6-contract §5.3): the organiser's current code, the link the QR carries and the QR itself as
 * SVG (QrRenderer: error correction Q, quiet zone 4, black on white, as the 2FA and sticker QRs; the app has no encoder).
 *
 * @property EventCheckinCode $resource
 */
class CheckinCodeResource extends JsonResource
{
    public function __construct(EventCheckinCode $resource, private readonly string $url, private readonly string $svg, private readonly int $checkedIn)
    {
        parent::__construct($resource);
    }

    /**
     * @return array<string, mixed>
     */
    public function toArray(Request $request): array
    {
        $code = $this->resource;

        return [
            /** Six characters of ABCDEFGHJKMNPQRSTUVWXYZ23456789. */
            'code' => $code->code,
            /** {APP_URL}/app/events/{slug}/checkin?code={code}: the camera app opens EVT-07. Never names the scanning member. */
            'url' => $this->url,
            /** The QR of `url`. */
            'svg' => $this->svg,
            /** When this code stops being the current one (it is accepted 60 s longer). */
            'expires_at' => $code->expires_at->toIso8601String(),
            /** Ask again at this moment (30 s before expires_at). */
            'refresh_at' => $code->expires_at->subSeconds(EventCheckins::REFRESH_LEAD)->toIso8601String(),
            /** How many checked in so far (the organiser's only live number). */
            'checked_in' => $this->checkedIn,
        ];
    }
}
