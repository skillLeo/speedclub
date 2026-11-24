<?php

namespace App\Services\Stickers;

use App\Models\QrCode;
use App\Models\Vehicle;
use App\Services\Garage\VehiclePresenter;
use App\Services\Qr\QrCodes;

/**
 * What a design prints for a vehicle (m5.4-contract §1.1): the sticker code (`/C/{code}`), or for the share picture the car's page
 * (`/v/{slug}`, ADR-514); the owner's @username; the nickname, else make, model and generation; the custom line.
 */
final class StickerContents
{
    public function __construct(
        private readonly QrCodes $codes,
        private readonly VehiclePresenter $presenter,
    ) {}

    public function for(Vehicle $vehicle, StickerOptions $options, ?QrCode $code, bool $share = false): StickerContent
    {
        $nickname = $vehicle->getAttribute('nickname');

        return new StickerContent(
            payload: match (true) {
                ! $options->qr => null,
                $share => $this->codes->pageUrl($vehicle),
                $code !== null => $this->codes->payload($code),
                default => null,
            },
            username: $vehicle->owner?->username,
            carName: is_string($nickname) && trim($nickname) !== '' ? trim($nickname) : ($this->presenter->fullTitle($vehicle) ?: null),
            customLine: $options->customLine,
        );
    }
}
