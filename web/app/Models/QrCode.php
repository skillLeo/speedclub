<?php

namespace App\Models;

use App\Enums\QrRevocationReason;
use App\Enums\QrStatus;
use Database\Factories\QrCodeFactory;
use Illuminate\Database\Eloquent\Attributes\Fillable;
use Illuminate\Database\Eloquent\Concerns\HasUlids;
use Illuminate\Database\Eloquent\Factories\HasFactory;
use Illuminate\Database\Eloquent\Model;
use Illuminate\Database\Eloquent\Relations\BelongsTo;
use Illuminate\Database\Eloquent\Relations\HasMany;

/**
 * @property string $code
 * @property QrStatus $status
 * @property Vehicle|null $vehicle Null for the tombstone a hard-deleted vehicle leaves behind.
 */
#[Fillable(['vehicle_id', 'code'])]
class QrCode extends Model
{
    /** @use HasFactory<QrCodeFactory> */
    use HasFactory, HasUlids;

    /**
     * @return array<string, string>
     */
    protected function casts(): array
    {
        return [
            'status' => QrStatus::class,
            'revoked_at' => 'datetime',
            'revoked_reason' => QrRevocationReason::class,
        ];
    }

    /**
     * @return BelongsTo<Vehicle, $this>
     */
    public function vehicle(): BelongsTo
    {
        return $this->belongsTo(Vehicle::class)->withTrashed();
    }

    /**
     * @return HasMany<QrScanDaily, $this>
     */
    public function scans(): HasMany
    {
        return $this->hasMany(QrScanDaily::class);
    }
}
