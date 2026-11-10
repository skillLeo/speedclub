<?php

namespace App\Models;

use Database\Factories\QrScanDailyFactory;
use Illuminate\Database\Eloquent\Attributes\Fillable;
use Illuminate\Database\Eloquent\Attributes\Table;
use Illuminate\Database\Eloquent\Factories\HasFactory;
use Illuminate\Database\Eloquent\Model;
use Illuminate\Database\Eloquent\Relations\BelongsTo;

/**
 * Per-day counter only: no IP, no user id (02_PRODUCT_SPEC §3.4).
 *
 * @property QrCode $qrCode
 */
#[Table('qr_scan_daily', timestamps: false)]
#[Fillable(['qr_code_id', 'day', 'count'])]
class QrScanDaily extends Model
{
    /** @use HasFactory<QrScanDailyFactory> */
    use HasFactory;

    /**
     * @return array<string, string>
     */
    protected function casts(): array
    {
        return [
            'day' => 'date',
            'count' => 'integer',
        ];
    }

    /**
     * @return BelongsTo<QrCode, $this>
     */
    public function qrCode(): BelongsTo
    {
        return $this->belongsTo(QrCode::class);
    }
}
