<?php

namespace App\Enums;

use App\Support\Enums\HasLabel;

/**
 * M5.9a (10 §16.1, ADR-509): what the member decided about number plates on a photo. Only the owner ever sees it (MediaResource).
 */
enum PlateBlurState: string
{
    use HasLabel;

    /** Pixelated into the master before any public file was made, at upload or later with GAR-08. */
    case Blurred = 'blurred';

    /** The member said there is nothing to hide: uploaded with the switch off, or "Kein Kennzeichen sichtbar" in the plate check. */
    case Declined = 'declined';

    /** Uploaded before M5.9a or by a client that does not send the switch: the one-time "Kennzeichen prüfen" lists it. */
    case Unchecked = 'unchecked';
}
