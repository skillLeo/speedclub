<?php

namespace App\Enums;

/**
 * M5.6 (m5.6-contract §4.1, §4.5): a gallery photo waits for the organiser (pending), is shown (approved), was turned down by the
 * organiser (rejected, the uploader alone still sees the row) or taken down by staff through a report (removed, never sent).
 */
enum GalleryPhotoStatus: string
{
    case Pending = 'pending';
    case Approved = 'approved';
    case Rejected = 'rejected';
    case Removed = 'removed';
}
