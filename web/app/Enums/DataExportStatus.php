<?php

namespace App\Enums;

use App\Support\Enums\HasLabel;

/**
 * SET-12. queued → running → ready → expired after 7 days; failed when a job gave up.
 */
enum DataExportStatus: string
{
    use HasLabel;

    case Queued = 'queued';
    case Running = 'running';
    case Ready = 'ready';
    case Failed = 'failed';
    case Expired = 'expired';
}
