<?php

use App\Enums\QrRevocationReason;

/**
 * What a stranger reads for each way a code can be revoked, for the app's resolver and for WEB-06 alike. Never a reason: only the
 * deleted vehicle and the deleted account read "nicht mehr verfügbar" (02_PRODUCT_SPEC §3.2).
 *
 * @return array<string, array{0: QrRevocationReason, 1: bool, 2: string, 3: string, 4: string}>
 */
function qrRevokedCopy(): array
{
    $revokedDe = ["Dieser QR-\u{2060}Code ist nicht mehr gültig", 'Dieser Sticker führt zu keinem Fahrzeug mehr.'];
    $revokedEn = ['This QR code is no longer valid', 'This sticker no longer leads to a vehicle.'];
    $goneDe = ['Dieses Fahrzeug ist nicht mehr verfügbar', 'Die Seite zu diesem Sticker gibt es nicht mehr.'];
    $goneEn = ['This vehicle is no longer available', 'The page behind this sticker no longer exists.'];

    return [
        'replaced, de' => [QrRevocationReason::Reissued, false, 'de', ...$revokedDe],
        'replaced, en' => [QrRevocationReason::Reissued, false, 'en', ...$revokedEn],
        'staff takedown, de' => [QrRevocationReason::Moderation, false, 'de', ...$revokedDe],
        'staff takedown, en' => [QrRevocationReason::Moderation, false, 'en', ...$revokedEn],
        'vehicle deleted, de' => [QrRevocationReason::VehicleDeleted, true, 'de', ...$goneDe],
        'vehicle deleted, en' => [QrRevocationReason::VehicleDeleted, true, 'en', ...$goneEn],
        'account deleted, de' => [QrRevocationReason::AccountDeleted, false, 'de', ...$goneDe],
        'account deleted, en' => [QrRevocationReason::AccountDeleted, false, 'en', ...$goneEn],
    ];
}
