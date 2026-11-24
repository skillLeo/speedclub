<?php

namespace App\Actions\Stickers;

use App\Enums\ErrorCode;
use App\Enums\QrStatus;
use App\Enums\StickerClientScanTest;
use App\Enums\StickerScanTest;
use App\Exceptions\ApiException;
use App\Models\StickerDesign;
use App\Models\Vehicle;
use App\Services\Qr\QrCodes;
use App\Services\Stickers\StickerFiles;
use App\Services\Stickers\StickerScanner;
use App\Support\Codes;
use Illuminate\Support\Facades\DB;

/**
 * The Scan-Test before a design may be printed or ordered (m5.4-contract §4): the current version is rendered with the car's active code
 * through the layout of the print files and decoded back by the server. Pass freezes the version with that code; fail stores the
 * result on the draft and answers 422. Without a code (QR off) the version is validated as `not_applicable`. Rendering and decoding
 * happen outside the transaction; the write then checks that nobody saved a newer version meanwhile **and** that the draft still holds
 * the template and options that were rendered (an autosave updates a draft in place at the same version, review MF-1): otherwise 409
 * `edit_conflict`, and nothing untested is ever frozen as passed. A validated version whose code was
 * replaced (reissue, staff takedown) is copied into the next version and tested with the active code.
 */
class ValidateStickerDesign
{
    public function __construct(
        private readonly StickerFiles $files,
        private readonly StickerScanner $scanner,
        private readonly QrCodes $codes,
    ) {}

    public function handle(Vehicle $vehicle, int $version, ?StickerClientScanTest $client): StickerDesign
    {
        $design = $this->current($vehicle, $version);

        if ($design->isValidated() && ! $this->codeReplaced($design)) {
            return $design;
        }

        if ($design->isValidated()) {
            // Its code was replaced or taken down: the same design opens the next version and is tested with the active code.
            $design = $this->nextVersion($vehicle, $design);
            $version = $design->version;
        }

        $options = $design->stickerOptions();
        $tested = self::fingerprint($design);
        $code = null;
        $result = StickerScanTest::NotApplicable;

        if ($options->qr) {
            $code = $vehicle->activeQrCode()->first() ?? throw new ApiException(ErrorCode::StickerNoActiveCode);
            $test = $this->scanner->test($this->files->artwork($vehicle, $options, $code), $this->codes->payload($code));
            $result = $test['passed'] ? StickerScanTest::Passed : StickerScanTest::Failed;
        }

        $design = DB::transaction(function () use ($vehicle, $version, $result, $code, $client, $tested): StickerDesign {
            Vehicle::withTrashed()->whereKey($vehicle->getKey())->lockForUpdate()->firstOrFail();
            $design = $this->current($vehicle, $version);

            // MF-1: an autosave during the render changed the draft in place; the result belongs to content that is gone.
            if (self::fingerprint($design) !== $tested) {
                throw new ApiException(ErrorCode::EditConflict, data: ['current_version' => $design->version]);
            }

            $design->forceFill([
                'scan_test' => $result,
                'client_scan_test' => $client,
                'qr_code_id' => $result === StickerScanTest::Failed ? null : $code?->getKey(),
                'validated_at' => $result === StickerScanTest::Failed ? null : now(),
            ])->save();

            return $design;
        });

        if ($result === StickerScanTest::Failed) {
            report(new \RuntimeException("Sticker design {$design->getKey()} failed the server Scan-Test."));

            throw new ApiException(ErrorCode::StickerScanFailed);
        }

        return $design;
    }

    /**
     * What the render depends on in the design row: its template and options (the car's lines and code are read separately).
     */
    public static function fingerprint(StickerDesign $design): string
    {
        $options = $design->options;
        ksort($options);

        return hash('sha256', json_encode([$design->template, $options], JSON_THROW_ON_ERROR));
    }

    private function codeReplaced(StickerDesign $design): bool
    {
        return $design->stickerOptions()->qr && $design->qrCode?->status !== QrStatus::Active;
    }

    private function nextVersion(Vehicle $vehicle, StickerDesign $from): StickerDesign
    {
        return DB::transaction(function () use ($vehicle, $from): StickerDesign {
            Vehicle::withTrashed()->whereKey($vehicle->getKey())->lockForUpdate()->firstOrFail();
            $this->current($vehicle, $from->version);

            return Codes::createUnique(fn (string $code): StickerDesign => StickerDesign::query()->create([
                'vehicle_id' => $vehicle->getKey(),
                'version' => $from->version + 1,
                // A new version is a content write too: the revision only ever grows (review MF-4).
                'revision' => $from->revision + 1,
                'reference' => 'SD'.$code,
                'template' => $from->template,
                'options' => $from->options,
            ]));
        });
    }

    private function current(Vehicle $vehicle, int $version): StickerDesign
    {
        /** @var StickerDesign|null $design */
        $design = $vehicle->stickerDesigns()->orderByDesc('version')->first();

        if ($design === null || $design->version !== $version) {
            throw new ApiException(ErrorCode::EditConflict, data: ['current_version' => $design === null ? 0 : $design->version]);
        }

        return $design;
    }
}
