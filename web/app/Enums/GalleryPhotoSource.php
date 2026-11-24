<?php

namespace App\Enums;

/**
 * M5.6 (m5.6-contract §4.1): who added a photo to an event's gallery. The organiser's photos publish at once, an attendee's wait for the
 * organiser's approval.
 */
enum GalleryPhotoSource: string
{
    case Organiser = 'organiser';
    case Attendee = 'attendee';
}
