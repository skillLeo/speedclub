<?php

namespace App\Services\Stickers;

use App\Actions\Stickers\SaveStickerDesign;
use App\Enums\StickerTemplate;
use App\Enums\VehicleStatus;
use App\Http\Resources\V1\Stickers\StickerCardResource;
use App\Models\StickerDesign;
use App\Models\User;
use App\Models\Vehicle;
use Illuminate\Contracts\Pagination\CursorPaginator;

/**
 * Reads of the sticker feature for the API (m5.4-contract §3): the hub page, the current design (or the unsaved default) and the live
 * preview of an unsaved state.
 */
final class StickerDesigns
{
    public function __construct(
        private readonly StickerStats $stats,
        private readonly StickerFiles $files,
        private readonly StickerSvg $svg,
    ) {}

    /**
     * @return CursorPaginator<int, Vehicle>
     */
    public function hub(User $user, int $pageSize): CursorPaginator
    {
        $page = $user->vehicles()
            ->where('status', '!=', VehicleStatus::Draft)
            ->with(StickerCardResource::RELATIONS)
            ->orderByDesc('is_main')
            ->orderBy('sort')
            ->orderBy('id')
            ->cursorPaginate($pageSize)
            ->withQueryString();

        /** @var list<string> $ids */
        $ids = $page->getCollection()->pluck('id')->all();
        $weeks = $this->stats->thisWeek($ids);
        $page->getCollection()->each(fn (Vehicle $vehicle) => $vehicle->setAttribute('scans_this_week', $weeks[$vehicle->id] ?? 0));

        return $page;
    }

    /**
     * The highest version, or an unsaved default design to start from.
     */
    public function current(Vehicle $vehicle): StickerDesign
    {
        /** @var StickerDesign|null $design */
        $design = $vehicle->stickerDesigns()->with('qrCode')->orderByDesc('version')->first();

        if ($design === null) {
            $template = StickerTemplate::Classic;
            $design = new StickerDesign([
                'vehicle_id' => $vehicle->id,
                'version' => 0,
                'template' => $template,
                'options' => StickerOptions::defaults($template, $vehicle->owner?->getAttribute('show_owner_on_qr') !== false)->toArray(),
            ]);
        }

        return $design->setRelation('vehicle', $vehicle);
    }

    /**
     * The editor's unsaved state over the stored one (or the defaults), with the car's active code.
     *
     * @param  array<string, mixed>  $input
     * @return array{svg: string, size_mm: array{width: float, height: float}, qr_mm: float|null, effective: array{username: bool, car_name: bool, custom_line: bool}, warnings: list<string>}
     */
    public function preview(Vehicle $vehicle, StickerTemplate $template, array $input): array
    {
        $current = $this->current($vehicle);
        $options = StickerOptions::fromArray($template, $input, $current->stickerOptions()->withTemplate($template));
        SaveStickerDesign::assertCombination($options);

        $code = $vehicle->activeQrCode()->first();
        $artwork = $this->files->artwork($vehicle, $options, $code);
        $warnings = ! $options->qr ? ['qr_off'] : ($code === null ? ['no_active_code'] : []);

        // A line too long to print legibly at this size is left out; the app names it.
        foreach ($artwork->droppedLines as $line) {
            $warnings[] = $line.'_too_long';
        }

        return [
            'svg' => $this->svg->preview($artwork, 'Speedclub Sticker'),
            'size_mm' => ['width' => $artwork->width, 'height' => $artwork->height],
            'qr_mm' => $artwork->qrSymbolMm() === null ? null : round($artwork->qrSymbolMm(), 1),
            'effective' => $options->effective(),
            'warnings' => $warnings,
        ];
    }
}
