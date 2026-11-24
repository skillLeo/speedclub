<?php

namespace App\Actions\Stickers;

use App\Enums\ErrorCode;
use App\Enums\KeywordField;
use App\Enums\StickerTemplate;
use App\Exceptions\ApiException;
use App\Models\StickerDesign;
use App\Models\Vehicle;
use App\Services\Rules\ContentScreen;
use App\Services\Stickers\StickerOptions;
use App\Support\Codes;
use Illuminate\Support\Facades\DB;
use Illuminate\Validation\ValidationException;

/**
 * Autosave of STK-05 (m5.4-contract §3.1). $baseVersion and $baseRevision are the version and revision the app last saw; another
 * device's save in between is a 409 edit_conflict. A draft is updated in place at the same version, so the version alone cannot see
 * that save: every content write raises `revision` (review MF-4), in place and on a new version alike, so it only ever grows. A
 * validated version stays frozen and the edit opens version n + 1. The same content as the current version writes nothing (the
 * revision stays). Options may be partial: the missing ones keep the current value, then the defaults.
 */
class SaveStickerDesign
{
    public function __construct(private readonly ContentScreen $screen) {}

    /**
     * @param  array<string, mixed>  $options
     */
    public function handle(Vehicle $vehicle, int $baseVersion, int $baseRevision, StickerTemplate $template, array $options): StickerDesign
    {
        return DB::transaction(function () use ($vehicle, $baseVersion, $baseRevision, $template, $options): StickerDesign {
            Vehicle::withTrashed()->whereKey($vehicle->getKey())->lockForUpdate()->firstOrFail();

            /** @var StickerDesign|null $current */
            $current = $vehicle->stickerDesigns()->orderByDesc('version')->first();
            $currentVersion = $current === null ? 0 : $current->version;
            $currentRevision = $current === null ? 0 : $current->revision;

            if ($baseVersion !== $currentVersion || $baseRevision !== $currentRevision) {
                throw new ApiException(ErrorCode::EditConflict, data: ['current_version' => $currentVersion, 'current_revision' => $currentRevision]);
            }

            $base = $current?->stickerOptions()->withTemplate($template) ?? StickerOptions::defaults($template, $vehicle->owner?->getAttribute('show_owner_on_qr') !== false);
            $next = StickerOptions::fromArray($template, $options, $base);
            self::assertCombination($next);

            $flags = $next->customLine === null || $next->customLine === $current?->stickerOptions()->customLine
                ? []
                : $this->screen->screen(['options.custom_line' => [KeywordField::StickerLine, $next->customLine]]);

            if ($current !== null && $current->template === $template && $current->stickerOptions()->toArray() === $next->toArray()) {
                return $current;
            }

            if ($current !== null && ! $current->isValidated()) {
                $current->forceFill([
                    'template' => $template,
                    'options' => $next->toArray(),
                    'revision' => $currentRevision + 1,
                    'scan_test' => null,
                    'client_scan_test' => null,
                ])->save();
                $this->screen->flagAfterCommit($flags, $vehicle);

                return $current;
            }

            $design = Codes::createUnique(fn (string $code): StickerDesign => StickerDesign::query()->create([
                'vehicle_id' => $vehicle->getKey(),
                'version' => $currentVersion + 1,
                'revision' => $currentRevision + 1,
                'reference' => 'SD'.$code,
                'template' => $template,
                'options' => $next->toArray(),
            ]));
            $this->screen->flagAfterCommit($flags, $vehicle);

            return $design;
        });
    }

    /**
     * The contrast rules of 10 §2.3 that span two options: white ink needs transparent vinyl (white on white vinyl cannot be seen, and
     * its code could not be read), and a mirrored print goes behind glass, so it is transparent too.
     */
    public static function assertCombination(StickerOptions $options): void
    {
        $errors = [];

        if (! in_array($options->material, $options->colourway->materials(), true)) {
            $errors['options.material'] = [(string) __('stickers.validation.white_needs_transparent')];
        }

        if ($options->mirrored && $options->material->value !== 'transparent') {
            $errors['options.mirrored'] = [(string) __('stickers.validation.mirrored_needs_transparent')];
        }

        if ($errors !== []) {
            throw ValidationException::withMessages($errors);
        }
    }
}
