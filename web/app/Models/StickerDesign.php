<?php

namespace App\Models;

use App\Enums\StickerClientScanTest;
use App\Enums\StickerScanTest;
use App\Enums\StickerTemplate;
use App\Services\Stickers\StickerOptions;
use Database\Factories\StickerDesignFactory;
use Illuminate\Database\Eloquent\Attributes\Fillable;
use Illuminate\Database\Eloquent\Concerns\HasUlids;
use Illuminate\Database\Eloquent\Factories\HasFactory;
use Illuminate\Database\Eloquent\Model;
use Illuminate\Database\Eloquent\Relations\BelongsTo;
use Illuminate\Support\Carbon;

/**
 * M5.4 (m5.4-contract §1): one version of a vehicle's sticker design. A validated version is frozen; its print files draw the code in
 * qr_code_id.
 *
 * @property string $id
 * @property string $vehicle_id
 * @property int $version
 * @property int $revision moves on every content write (autosave, restore, new version); the PUT's conflict check (review MF-4)
 * @property string $reference
 * @property StickerTemplate $template
 * @property array<string, mixed> $options
 * @property string|null $qr_code_id
 * @property Carbon|null $validated_at
 * @property StickerScanTest|null $scan_test
 * @property StickerClientScanTest|null $client_scan_test
 * @property Carbon|null $order_requested_at
 * @property Carbon|null $created_at
 * @property Carbon|null $updated_at
 * @property Vehicle|null $vehicle
 * @property QrCode|null $qrCode
 */
#[Fillable(['vehicle_id', 'version', 'revision', 'reference', 'template', 'options'])]
class StickerDesign extends Model
{
    /** @use HasFactory<StickerDesignFactory> */
    use HasFactory, HasUlids;

    /**
     * @return array<string, string>
     */
    protected function casts(): array
    {
        return [
            'version' => 'integer',
            'revision' => 'integer',
            'template' => StickerTemplate::class,
            'options' => 'array',
            'validated_at' => 'datetime',
            'scan_test' => StickerScanTest::class,
            'client_scan_test' => StickerClientScanTest::class,
            'order_requested_at' => 'datetime',
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
     * @return BelongsTo<QrCode, $this>
     */
    public function qrCode(): BelongsTo
    {
        return $this->belongsTo(QrCode::class);
    }

    public function isValidated(): bool
    {
        return $this->validated_at !== null;
    }

    public function stickerOptions(): StickerOptions
    {
        return StickerOptions::fromArray($this->template, $this->options);
    }
}
