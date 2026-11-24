<?php

namespace App\Http\Controllers\Admin\Spots;

use App\Actions\Admin\Moderation\RemoveSpots;
use App\Enums\AuditActorType;
use App\Http\Controllers\Admin\Support\MediaUrls;
use App\Models\AuditEvent;
use App\Models\Spot;
use App\Models\Staff;
use App\Services\Admin\Spots\SpotSignals;
use App\Services\Audit\Audit;
use App\Services\Garage\VehiclePresenter;
use Illuminate\Support\Carbon;
use Illuminate\Support\Facades\Cache;

/**
 * ADM-62 Spot record: the spot (time, city, counted, night, First Spotter, source), the spotter and the car with its owner, its signals,
 * the spotter's other spots within an hour either side (the context a burst or a hop is judged in) and the spotter's removed spots with
 * who removed them (the reason only for audit.view, as on every activity list).
 *
 * A spot record lays out where a member was and when (city level); the first view a day per staff member is audited (`spot.viewed`,
 * 06 §1 "every view of sensitive data"), without the spot's content.
 */
final class SpotAdminRecord
{
    public const VIEWED_EVENT = 'spot.viewed';

    private const CONTEXT_SECONDS = 3600;

    private const CONTEXT_MAX = 50;

    private const REMOVALS_MAX = 20;

    /**
     * @return array<string, mixed>
     */
    public static function detail(Spot $spot, Staff $staff, SpotSignals $signals): array
    {
        $presenter = app(VehiclePresenter::class);
        $vehicle = $spot->vehicle;
        $at = $spot->created_at;

        $context = $at === null ? [] : Spot::withTrashed()->with(['city:id,name', 'vehicle' => fn ($v) => $v->with(['make', 'vehicleModel', 'generation'])])
            ->where('spotter_id', $spot->spotter_id)
            ->whereBetween('created_at', [$at->copy()->subSeconds(self::CONTEXT_SECONDS), $at->copy()->addSeconds(self::CONTEXT_SECONDS)])
            ->orderBy('created_at')->orderBy('id')->limit(self::CONTEXT_MAX)->get()->all();
        $removed = Spot::onlyTrashed()->with(['city:id,name', 'vehicle' => fn ($v) => $v->with(['make', 'vehicleModel', 'generation'])])
            ->where('spotter_id', $spot->spotter_id)->orderByDesc('deleted_at')->orderByDesc('id')->limit(self::REMOVALS_MAX)->get()->all();

        $flags = $signals->forSpots([$spot, ...$context]);
        $removedBy = self::removedBy(array_map(fn (Spot $s): string => $s->id, [$spot, ...$removed]), $staff->can('audit.view'));

        $line = fn (Spot $s): array => [
            'id' => $s->id,
            'spotted_at' => $s->created_at?->toIso8601String(),
            'vehicle' => ['id' => $s->vehicle_id, 'title' => $presenter->fullTitle($s->vehicle), 'dex_number' => $s->vehicle->dex_number],
            'city' => $s->city?->name,
            'night' => $s->is_night,
            'removed_at' => $s->getAttribute('deleted_at')?->toIso8601String(),
        ];

        return [
            'id' => $spot->id,
            'spotted_at' => $at?->toIso8601String(),
            'removed_at' => $spot->getAttribute('deleted_at')?->toIso8601String(),
            'removal' => $removedBy[$spot->id] ?? null,
            'counted' => $spot->counted,
            'night' => $spot->is_night,
            'first_three' => $spot->is_first_three,
            'source' => $spot->source->value,
            'city' => $spot->city?->name,
            'bundesland' => $spot->bundesland?->value,
            'spotter' => [
                'id' => $spot->spotter_id,
                'username' => $spot->spotter?->username,
                'display_name' => $spot->spotter?->display_name,
                'joined_at' => $spot->spotter?->created_at?->toIso8601String(),
                'spots' => Spot::query()->where('spotter_id', $spot->spotter_id)->count(),
                'removed' => Spot::onlyTrashed()->where('spotter_id', $spot->spotter_id)->count(),
            ],
            'vehicle' => [
                'id' => $vehicle->id,
                'title' => $presenter->fullTitle($vehicle),
                'dex_number' => $vehicle->dex_number,
                'cover' => MediaUrls::at($vehicle->cover, 320),
                'cover_focus' => MediaUrls::focus($vehicle->cover),
                'cover_placeholder' => MediaUrls::placeholder($vehicle->cover),
                'owner' => $vehicle->owner === null ? null : ['id' => $vehicle->owner->id, 'username' => $vehicle->owner->username],
            ],
            'signals' => $flags[$spot->id] ?? ['burst' => null, 'device' => null, 'hop' => null],
            'context' => array_map(fn (Spot $s): array => [...$line($s), 'current' => $s->id === $spot->id, 'signals' => $flags[$s->id] ?? null], $context),
            'removals' => array_map(fn (Spot $s): array => [...$line($s), 'by' => $removedBy[$s->id]['by'] ?? null, 'reason' => $removedBy[$s->id]['reason'] ?? null], $removed),
            'can' => ['remove' => $staff->can('moderation.decide') && ! $spot->trashed()],
        ];
    }

    public static function auditView(Spot $spot, Staff $staff): void
    {
        if (Cache::add("admin:spot-viewed:{$staff->getKey()}:{$spot->id}", true, now()->endOfDay())) {
            Audit::record(self::VIEWED_EVENT, $spot, null, null, null, $staff);
        }
    }

    /**
     * Who removed which of these spots (the newest `spot.removed` event of each), the reason only for audit.view.
     *
     * @param  list<string>  $ids
     * @return array<string, array{by: string|null, at: string|null, reason: string|null}>
     */
    private static function removedBy(array $ids, bool $withReasons): array
    {
        $events = AuditEvent::query()->where('action', RemoveSpots::EVENT)->where('target_type', 'spot')->whereIn('target_id', $ids)
            ->orderBy('id')->get(['id', 'target_id', 'actor_type', 'actor_id', 'occurred_at', 'reason']);
        $staffIds = $events->filter(fn (AuditEvent $e): bool => $e->getRawOriginal('actor_type') === AuditActorType::Staff->value)
            ->map(fn (AuditEvent $e): string => (string) $e->getRawOriginal('actor_id'))->unique()->values()->all();
        $names = Staff::query()->whereIn('id', $staffIds)->pluck('name', 'id');

        $by = [];
        foreach ($events as $event) {
            $actor = (string) $event->getRawOriginal('actor_id');
            $at = $event->getRawOriginal('occurred_at');
            $by[(string) $event->getRawOriginal('target_id')] = [
                'by' => is_string($names[$actor] ?? null) ? $names[$actor] : null,
                'at' => is_string($at) ? Carbon::parse($at, 'UTC')->toIso8601String() : null,
                'reason' => $withReasons ? $event->reason : null,
            ];
        }

        return $by;
    }
}
