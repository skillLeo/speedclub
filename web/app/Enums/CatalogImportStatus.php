<?php

namespace App\Enums;

/**
 * ADM-17 lifecycle: analysed (dry run done, nothing changed) → awaiting_approval (more than 100 changed rows, four-eyes) → queued →
 * applying → applied | failed. `expired`: the file is gone (30 days) or the dry run was replaced.
 * Labels live with the admin page (lang/admin/<locale>/catalog.json).
 */
enum CatalogImportStatus: string
{
    case Analysed = 'analysed';
    case AwaitingApproval = 'awaiting_approval';
    case Queued = 'queued';
    case Applying = 'applying';
    case Applied = 'applied';
    case Failed = 'failed';
    case Expired = 'expired';

    public function isRunning(): bool
    {
        return $this === self::Queued || $this === self::Applying;
    }
}
