<?php

namespace App\Enums;

/**
 * M5.9d audit actions of the supporting system: the admin badge manager and Car of the Day decisions (staff), and the system's
 * assignment of a Founding Member number. The gift fix batch (ADR-514) adds the system's withdrawal of an ineligible Car of the Day,
 * the set completions taken back after staff removed spots, and the staging rotation of sample sticker codes. SEC-P5G-05: staff take
 * an earned badge back from a member (abuse).
 */
enum GiftEvent: string
{
    case BadgeCreated = 'badge.created';
    case BadgeUpdated = 'badge.updated';
    case BadgeActivated = 'badge.activated';
    case BadgeDeactivated = 'badge.deactivated';
    case BadgeApplied = 'badge.applied';
    case CarOfTheDayOverridden = 'car_of_the_day.overridden';
    case CarOfTheDaySkipped = 'car_of_the_day.skipped';
    case FoundingNumberAssigned = 'founding.assigned';
    case CarOfTheDayWithdrawn = 'car_of_the_day.withdrawn';
    case DexSetRevoked = 'dex.set_revoked';
    case SampleQrRotated = 'qr.sample_rotated';
    case BadgeRevoked = 'badge.revoked';
}
