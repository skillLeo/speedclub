<?php

namespace App\Actions\Stickers;

use App\Enums\ErrorCode;
use App\Exceptions\ApiException;
use App\Models\StickerDesign;
use App\Models\Vehicle;

/**
 * STK-07 "Wiederherstellen": an older version's template and options become the current draft, through the same rules as an autosave
 * (a validated current version stays and the restore opens the next one). $baseRevision is the revision the app last saw of the current
 * version: a save from another device in between answers 409 edit_conflict (review MF-4).
 */
class RestoreStickerDesign
{
    public function __construct(private readonly SaveStickerDesign $save) {}

    public function handle(Vehicle $vehicle, int $version, int $baseRevision): StickerDesign
    {
        /** @var StickerDesign|null $source */
        $source = $vehicle->stickerDesigns()->where('version', $version)->first();

        if ($source === null) {
            throw new ApiException(ErrorCode::NotFound);
        }

        $current = (int) $vehicle->stickerDesigns()->max('version');

        return $this->save->handle($vehicle, $current, $baseRevision, $source->template, $source->stickerOptions()->toArray());
    }
}
