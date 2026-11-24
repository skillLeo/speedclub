<?php

namespace App\Services\Stickers;

use App\Enums\QrStatus;
use App\Enums\StickerTemplate;
use App\Models\StickerDesign;
use App\Services\Garage\VehiclePresenter;
use App\Services\Qr\QrCodes;
use Illuminate\Database\Eloquent\Builder;
use Illuminate\Http\Request;
use Spatie\QueryBuilder\AllowedFilter;
use Spatie\QueryBuilder\AllowedSort;
use Spatie\QueryBuilder\QueryBuilder;

/**
 * The rows of ADM "Sticker-Designs" (m5.4-contract §8): filters `state` (draft, validated, ordered), `template`, `q` (design id, sticker
 * code or username, as a prefix); sorts by created, validated and order request, newest order requests first, the id breaking ties.
 */
final class StickerAdminRows
{
    public function __construct(
        private readonly VehiclePresenter $presenter,
        private readonly QrCodes $codes,
    ) {}

    /**
     * @return QueryBuilder<StickerDesign>
     */
    public function query(Request $request, string $defaultSort): QueryBuilder
    {
        $base = StickerDesign::query()->with(['qrCode', 'vehicle' => fn ($q) => $q->with(['make', 'vehicleModel', 'generation', 'owner:id,username'])]);

        $query = QueryBuilder::for($base, $request)
            ->allowedFilters(
                AllowedFilter::callback('state', fn (Builder $q, mixed $value) => match ($value) {
                    'draft' => $q->whereNull('sticker_designs.validated_at'),
                    'validated' => $q->whereNotNull('sticker_designs.validated_at'),
                    'ordered' => $q->whereNotNull('sticker_designs.order_requested_at'),
                    default => $q->whereRaw('1 = 0'),
                })->delimiter("\u{1}"),
                AllowedFilter::callback('template', fn (Builder $q, mixed $value) => $q->where('sticker_designs.template', StickerTemplate::tryFrom(is_string($value) ? $value : '')->value ?? '-'))->delimiter("\u{1}"),
                AllowedFilter::callback('q', function (Builder $q, mixed $value): void {
                    $term = str_replace(' ', '', is_string($value) ? trim($value) : '');
                    $like = addcslashes($term, '%_\\').'%';

                    $q->where(fn (Builder $w) => $w
                        ->where('sticker_designs.reference', 'like', strtoupper($like))
                        ->orWhereHas('qrCode', fn (Builder $c) => $c->where('code', 'like', strtoupper($like)))
                        ->orWhereHas('vehicle.owner', fn (Builder $o) => $o->where('username', 'like', strtolower(ltrim($like, '@')))));
                })->delimiter("\u{1}"),
            )
            ->allowedSorts(
                'created_at',
                'validated_at',
                // Never requested sorts last either way.
                AllowedSort::callback('order_requested_at', fn (Builder $q, bool $descending) => $q
                    ->orderByRaw('sticker_designs.order_requested_at is null')
                    ->orderBy('sticker_designs.order_requested_at', $descending ? 'desc' : 'asc')),
            )
            ->defaultSort($defaultSort);
        $query->getEloquentBuilder()->orderByDesc('sticker_designs.validated_at')->orderBy('sticker_designs.id');

        return $query;
    }

    /**
     * @param  list<StickerDesign>  $designs
     * @return list<array<string, mixed>>
     */
    public function map(array $designs): array
    {
        return array_map(function (StickerDesign $design): array {
            $options = $design->stickerOptions();
            $vehicle = $design->vehicle;
            $code = $design->qrCode;
            $printable = $design->isValidated() && (! $options->qr || $code?->status === QrStatus::Active);

            return [
                'id' => $design->id,
                'reference' => $design->reference,
                'version' => $design->version,
                'template' => $design->template->value,
                'size' => $options->size->value,
                'size_mm' => StickerCatalogue::size($design->template, $options->size),
                'colourway' => $options->colourway->value,
                'material' => $options->material->value,
                'mirrored' => $options->mirrored,
                'qr' => $options->qr,
                'scan_test' => $design->scan_test?->value,
                'state' => $design->isValidated() ? 'validated' : 'draft',
                'validated_at' => $design->validated_at?->toIso8601String(),
                'order_requested_at' => $design->order_requested_at?->toIso8601String(),
                'code' => $code === null ? null : ['display_code' => $this->codes->displayCode($code->code), 'active' => $code->status === QrStatus::Active],
                'vehicle' => $vehicle === null ? null : ['id' => $vehicle->id, 'title' => $this->presenter->fullTitle($vehicle), 'deleted' => $vehicle->trashed()],
                'owner' => $vehicle?->owner === null ? null : ['id' => $vehicle->owner->id, 'username' => $vehicle->owner->username],
                'downloads' => $printable ? [
                    'pdf' => route('admin.stickers.designs.print-pdf', ['design' => $design->reference]),
                    'svg' => route('admin.stickers.designs.print-svg', ['design' => $design->reference]),
                ] : null,
                'created_at' => $design->created_at?->toIso8601String(),
            ];
        }, $designs);
    }

    /**
     * A design by its ULID or its design id ("SD7H2KQXMB", any case); 404 otherwise.
     */
    public static function find(string $key): StickerDesign
    {
        $design = strlen($key) === 26
            ? StickerDesign::query()->find(strtolower($key))
            : StickerDesign::query()->where('reference', strtoupper($key))->first();

        abort_unless($design instanceof StickerDesign, 404);

        return $design;
    }
}
