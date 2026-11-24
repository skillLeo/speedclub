<?php

namespace Database\Factories;

use App\Enums\StickerScanTest;
use App\Enums\StickerTemplate;
use App\Models\StickerDesign;
use App\Models\Vehicle;
use App\Services\Stickers\StickerOptions;
use App\Support\Codes;
use Illuminate\Database\Eloquent\Factories\Factory;

/**
 * @extends Factory<StickerDesign>
 */
class StickerDesignFactory extends Factory
{
    /**
     * @return array<string, mixed>
     */
    public function definition(): array
    {
        return [
            'vehicle_id' => Vehicle::factory()->published(),
            'version' => 1,
            'reference' => 'SD'.Codes::generate(),
            'template' => StickerTemplate::Classic,
            'options' => StickerOptions::defaults(StickerTemplate::Classic)->toArray(),
        ];
    }

    /**
     * Validated with QR on; pass the code the Scan-Test used.
     */
    public function validated(?string $qrCodeId = null): static
    {
        return $this->state(fn (array $attributes) => [])->afterMaking(function (StickerDesign $design) use ($qrCodeId): void {
            $design->forceFill([
                'validated_at' => now(),
                'scan_test' => $design->stickerOptions()->qr ? StickerScanTest::Passed : StickerScanTest::NotApplicable,
                'qr_code_id' => $qrCodeId,
            ]);
        });
    }
}
