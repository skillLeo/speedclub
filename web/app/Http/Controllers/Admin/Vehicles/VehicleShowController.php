<?php

namespace App\Http\Controllers\Admin\Vehicles;

use App\Enums\ReportTargetType;
use App\Http\Controllers\Admin\Support\ActivityFeed;
use App\Http\Controllers\Admin\Support\MediaUrls;
use App\Http\Controllers\Admin\Support\QaClock;
use App\Http\Controllers\Controller;
use App\Models\BuildUpdate;
use App\Models\Decision;
use App\Models\Generation;
use App\Models\Make;
use App\Models\Media;
use App\Models\ModerationCase;
use App\Models\Modification;
use App\Models\QrCode;
use App\Models\QrScanDaily;
use App\Models\Staff;
use App\Models\Vehicle;
use App\Models\VehicleModel;
use App\Services\Garage\VehiclePresenter;
use App\Services\Moderation\ModerationHolds;
use Illuminate\Http\Request;
use Inertia\Inertia;
use Inertia\Response;

/**
 * ADM-12 vehicle record (m3.2-contract §2): tabs Details · Fotos · Mods · QR · Verlauf · Meldungen, the activity from the audit log, and
 * the catalogue options of the edit drawer (loaded when it opens). Only the open tab is read.
 */
class VehicleShowController extends Controller
{
    public const TABS = ['details', 'photos', 'mods', 'qr', 'history', 'reports'];

    public function __invoke(Request $request, Vehicle $vehicle, VehiclePresenter $presenter, ModerationHolds $holds): Response
    {
        /** @var Staff $staff */
        $staff = $request->user('staff');
        $tab = $request->query('tab');
        $tab = is_string($tab) && in_array($tab, self::TABS, true) ? $tab : 'details';
        $panel = fn (string $name, callable $resolve): mixed => $tab === $name ? $resolve : Inertia::optional($resolve);
        $vehicle->loadMissing(['make', 'vehicleModel', 'generation', 'cover', 'owner:id,username,display_name']);

        return Inertia::render('Vehicles/Show', [
            'vehicle' => fn (): array => self::details($vehicle, $presenter, $holds),
            'tab' => $tab,
            'photos' => $panel('photos', fn (): array => self::photos($vehicle)),
            'mods' => $panel('mods', fn (): array => self::mods($vehicle)),
            'qr' => $panel('qr', fn (): array => self::codes($vehicle, $request)),
            'history' => $panel('history', fn (): array => self::history($vehicle)),
            'reports' => $panel('reports', fn (): array => self::reports($vehicle)),
            'activity' => fn (): array => ActivityFeed::for(self::targets($vehicle), $staff),
            'catalog' => Inertia::optional(fn (): array => self::catalog($vehicle, $request)),
        ]);
    }

    /**
     * @return array<string, mixed>
     */
    private static function details(Vehicle $vehicle, VehiclePresenter $presenter, ModerationHolds $holds): array
    {
        $removal = $holds->activeRemoval(ReportTargetType::Vehicle, $vehicle->id);

        return [
            'id' => $vehicle->id,
            'public_id' => $vehicle->public_id,
            'slug' => $vehicle->slug,
            'title' => $presenter->fullTitle($vehicle),
            'make' => $presenter->makeName($vehicle),
            'model' => $presenter->modelName($vehicle),
            'generation' => $vehicle->generation?->name,
            'make_id' => $vehicle->make_id,
            'model_id' => $vehicle->getAttribute('model_id'),
            'generation_id' => $vehicle->getAttribute('generation_id'),
            'make_text' => $vehicle->getAttribute('make_text'),
            'model_text' => $vehicle->getAttribute('model_text'),
            'model_year' => $vehicle->model_year,
            'nickname' => $vehicle->getAttribute('nickname'),
            'color' => $vehicle->getAttribute('color'),
            'description' => $vehicle->getAttribute('description'),
            'status' => $vehicle->status->value,
            'visibility' => $vehicle->visibility->value,
            'deleted' => $vehicle->trashed(),
            'hidden' => $removal !== null,
            'hidden_since' => $removal?->decided_at->toIso8601String(),
            'cover' => MediaUrls::at($vehicle->cover, 320),
            'cover_focus' => MediaUrls::focus($vehicle->cover),
            'cover_placeholder' => MediaUrls::placeholder($vehicle->cover),
            'owner' => $vehicle->owner === null ? null : ['id' => $vehicle->owner->id, 'username' => $vehicle->owner->username, 'display_name' => $vehicle->owner->getAttribute('display_name')],
            'public_url' => $vehicle->status->value === 'published' && $vehicle->visibility->value === 'public' && $removal === null && ! $vehicle->trashed()
                ? route('public.vehicle', ['slug' => $vehicle->slug]) : null,
            'published_at' => $vehicle->getAttribute('published_at')?->toIso8601String(),
            'created_at' => $vehicle->created_at?->toIso8601String(),
            'updated_at' => $vehicle->updated_at?->toIso8601String(),
        ];
    }

    /**
     * @return list<array<string, mixed>>
     */
    private static function photos(Vehicle $vehicle): array
    {
        return array_values(Media::withTrashed()
            ->where('mediable_type', $vehicle->getMorphClass())
            ->where('mediable_id', $vehicle->id)
            ->orderBy('sort')
            ->orderBy('id')
            ->get()
            ->map(fn (Media $media): array => [
                'id' => $media->id,
                'url' => MediaUrls::at($media, 320),
                'category' => $media->getAttribute('category')?->value,
                'alt' => $media->getAttribute('alt'),
                'status' => $media->status->value,
                'moderation_status' => $media->moderation_status->value,
                'reviewed_at' => $media->reviewed_at?->toIso8601String(),
                'deleted' => $media->trashed(),
                'created_at' => $media->created_at?->toIso8601String(),
            ])->all());
    }

    /**
     * @return list<array<string, mixed>>
     */
    private static function mods(Vehicle $vehicle): array
    {
        $locale = app()->getLocale();

        return array_values(Modification::query()
            ->where('vehicle_id', $vehicle->id)
            ->with(['category', 'brand'])
            ->orderBy('sort')
            ->orderBy('id')
            ->get()
            ->map(function (Modification $mod) use ($locale): array {
                $name = $mod->category->getAttribute('name');

                return [
                    'id' => $mod->id,
                    'title' => $mod->getAttribute('title'),
                    'category' => is_array($name) ? ($name[$locale] ?? $name['de'] ?? null) : (is_string($name) ? $name : null),
                    // The category's glyph (03 §6 map: wheel, coilover, … or Phosphor "wrench" for Sonstiges).
                    'category_icon' => is_string($mod->category->getAttribute('icon')) ? $mod->category->getAttribute('icon') : null,
                    'brand' => $mod->brand?->getAttribute('name') ?? $mod->getAttribute('brand_text'),
                    'status' => self::enumValue($mod->getAttribute('status')),
                    'legal_status' => self::enumValue($mod->getAttribute('legal_status')),
                    'installed_on' => $mod->getAttribute('installed_on')?->toDateString(),
                ];
            })->all());
    }

    /**
     * Every code the vehicle ever had, newest first, with its scans of the last 30 days.
     *
     * @return list<array<string, mixed>>
     */
    private static function codes(Vehicle $vehicle, Request $request): array
    {
        $codes = QrCode::query()->where('vehicle_id', $vehicle->id)->orderByDesc('created_at')->orderByDesc('id')->get();
        $since = QaClock::today($request)->subDays(29)->toDateString();
        $scans = QrScanDaily::query()->whereIn('qr_code_id', $codes->pluck('id'))->where('day', '>=', $since)
            ->groupBy('qr_code_id')->selectRaw('qr_code_id, SUM(count) as total')->pluck('total', 'qr_code_id');

        return array_values($codes->map(fn (QrCode $qr): array => [
            'id' => $qr->id,
            'code' => $qr->code,
            'status' => $qr->status->value,
            'revoked_reason' => $qr->getAttribute('revoked_reason')?->value,
            'revoked_at' => $qr->getAttribute('revoked_at')?->toIso8601String(),
            'created_at' => $qr->created_at?->toIso8601String(),
            'scans_30' => (int) ($scans[$qr->id] ?? 0),
        ])->all());
    }

    /**
     * @return list<array<string, mixed>>
     */
    private static function history(Vehicle $vehicle): array
    {
        return array_values(BuildUpdate::query()->where('vehicle_id', $vehicle->id)->orderByDesc('created_at')->orderByDesc('id')->limit(100)->get()
            ->map(function (BuildUpdate $update): array {
                $payload = $update->getAttribute('payload');
                $payload = is_array($payload) ? $payload : [];

                return [
                    'id' => $update->id,
                    'type' => $update->type->value,
                    'label' => is_string($payload['label'] ?? null) ? $payload['label'] : null,
                    'before' => is_string($payload['before'] ?? null) ? $payload['before'] : null,
                    'after' => is_string($payload['after'] ?? null) ? $payload['after'] : null,
                    'note' => $update->getAttribute('note'),
                    'hidden' => (bool) $update->getAttribute('hidden'),
                    'created_at' => $update->created_at?->toIso8601String(),
                ];
            })->all());
    }

    /**
     * Cases about the vehicle or one of its photos, newest first.
     *
     * @return list<array<string, mixed>>
     */
    private static function reports(Vehicle $vehicle): array
    {
        $photoIds = Media::withTrashed()->where('mediable_type', $vehicle->getMorphClass())->where('mediable_id', $vehicle->id)->pluck('id')->all();

        return array_values(ModerationCase::query()
            ->where(fn ($q) => $q->where(fn ($v) => $v->where('target_type', ReportTargetType::Vehicle->value)->where('target_id', $vehicle->id))
                ->orWhere(fn ($p) => $p->where('target_type', ReportTargetType::Photo->value)->whereIn('target_id', $photoIds === [] ? ['-'] : $photoIds)))
            ->with('decision:id,case_id,action,decided_at,reverses_decision_id')
            ->orderByDesc('created_at')
            ->orderByDesc('id')
            ->limit(50)
            ->get()
            ->map(fn (ModerationCase $case): array => [
                'case_id' => $case->id,
                'origin' => $case->origin->value,
                'status' => $case->status->value,
                'target_type' => $case->target_type->value,
                'report_count' => $case->report_count,
                'created_at' => $case->created_at?->toIso8601String(),
                'decision' => $case->decision instanceof Decision ? ['action' => $case->decision->action->value, 'decided_at' => $case->decision->decided_at->toIso8601String()] : null,
            ])->all());
    }

    /**
     * @return array<string, list<string>>
     */
    private static function targets(Vehicle $vehicle): array
    {
        // The decisions on the vehicle and on its photos, like the Meldungen tab (review N-7).
        $photoIds = Media::withTrashed()->where('mediable_type', $vehicle->getMorphClass())->where('mediable_id', $vehicle->id)->pluck('id')->all();
        $cases = ModerationCase::query()
            ->where(fn ($q) => $q->where(fn ($v) => $v->where('target_type', ReportTargetType::Vehicle->value)->where('target_id', $vehicle->id))
                ->orWhere(fn ($p) => $p->where('target_type', ReportTargetType::Photo->value)->whereIn('target_id', $photoIds === [] ? ['-'] : $photoIds)))
            ->pluck('id');

        return [
            'vehicle' => [$vehicle->id],
            'decision' => array_values(Decision::query()->whereIn('case_id', $cases)->pluck('id')->map(fn (mixed $id): string => (string) $id)->all()),
            'qr_code' => array_values(QrCode::query()->where('vehicle_id', $vehicle->id)->pluck('id')->map(fn (mixed $id): string => (string) $id)->all()),
        ];
    }

    /**
     * The edit drawer's catalogue: every make, the models of the chosen make, the generations of the chosen model
     * (`?catalog_make=` / `?catalog_model=` while the drawer is open, else the vehicle's own).
     *
     * @return array{makes: list<array{value: string, label: string}>, models: list<array{value: string, label: string}>, generations: list<array{value: string, label: string}>}
     */
    private static function catalog(Vehicle $vehicle, Request $request): array
    {
        $make = is_numeric($request->query('catalog_make')) ? (int) $request->query('catalog_make') : $vehicle->make_id;
        $model = is_numeric($request->query('catalog_model')) ? (int) $request->query('catalog_model') : $vehicle->getAttribute('model_id');
        $option = fn (int|string $id, string $label): array => ['value' => (string) $id, 'label' => $label];

        return [
            'makes' => array_values(Make::query()->orderBy('name')->get(['id', 'name'])->map(fn (Make $m): array => $option($m->id, $m->name))->all()),
            'models' => $make === null ? [] : array_values(VehicleModel::query()->where('make_id', $make)->orderBy('name')->get(['id', 'name'])->map(fn (VehicleModel $m): array => $option($m->id, $m->name))->all()),
            'generations' => ! is_int($model) ? [] : array_values(Generation::query()->where('model_id', $model)->orderBy('year_from')->orderBy('id')->get(['id', 'name', 'year_from', 'year_to'])
                ->map(fn (Generation $g): array => $option($g->id, trim($g->name.' ('.$g->getAttribute('year_from').'–'.($g->getAttribute('year_to') ?? '').')')))->all()),
        ];
    }

    private static function enumValue(mixed $value): ?string
    {
        return $value instanceof \BackedEnum ? (string) $value->value : (is_string($value) ? $value : null);
    }
}
