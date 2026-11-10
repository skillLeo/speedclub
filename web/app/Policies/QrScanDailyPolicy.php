<?php

namespace App\Policies;

use App\Models\QrScanDaily;
use App\Models\User;

class QrScanDailyPolicy
{
    /**
     * Counts are the owner's only (QR-02). The sig.qr_stats flag is checked by the endpoint.
     */
    public function view(User $user, QrScanDaily $scan): bool
    {
        return (new QrCodePolicy)->view($user, $scan->qrCode);
    }
}
