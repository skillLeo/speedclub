<?php

namespace App\Http\Controllers\Admin\Qr;

use App\Enums\AdminMemberEvent;
use App\Enums\QrRevocationReason;
use App\Http\Controllers\Admin\Support\ActivityFeed;
use App\Http\Controllers\Admin\Support\QaClock;
use App\Http\Controllers\Admin\Support\RecordLookup;
use App\Http\Controllers\Controller;
use App\Models\AuditEvent;
use App\Models\QrCode;
use App\Models\QrScanDaily;
use App\Models\Staff;
use App\Services\Garage\VehiclePresenter;
use App\Services\Qr\QrCodes;
use Carbon\CarbonImmutable;
use Illuminate\Database\Eloquent\Builder;
use Illuminate\Http\Request;
use Inertia\Inertia;
use Inertia\Response;

/**
 * ADM-19 QR detail (06 §3 QR): daily scans of the last 30 or 90 days (`?days=`, counts only), the code's history (created, revoked,
 * reissued, by whom) and the vehicle's other codes. Revoke / reissue are QrActionsController.
 */
class QrShowController extends Controller
{
    public function __invoke(Request $request, string $qr, VehiclePresenter $presenter, QrCodes $codes): Response
    {
        /** @var Staff $staff */
        $staff = $request->user('staff');
        $code = RecordLookup::qr($qr);
        $days = $request->query('days') === '90' ? 90 : 30;
        $code->loadMissing(['vehicle' => fn ($q) => $q->with(['make', 'vehicleModel', 'generation', 'owner:id,username'])]);
        $vehicle = $code->vehicle;

        return Inertia::render('Qr/Show', [
            'qr' => [
                'id' => $code->id,
                'code' => $code->code,
                'display_code' => $codes->displayCode($code->code),
                'status' => $code->status->value,
                'revoked_reason' => $code->getAttribute('revoked_reason')?->value,
                'revoked_at' => $code->getAttribute('revoked_at')?->toIso8601String(),
                'created_at' => $code->created_at?->toIso8601String(),
                'vehicle' => $vehicle === null ? null : [
                    'id' => $vehicle->id,
                    'title' => $presenter->fullTitle($vehicle),
                    'status' => $vehicle->status->value,
                    'deleted' => $vehicle->trashed(),
                ],
                'owner' => $vehicle?->owner === null ? null : ['id' => $vehicle->owner->id, 'username' => $vehicle->owner->username],
                'can_reissue' => $vehicle !== null && ! $vehicle->trashed() && $vehicle->status->value === 'published',
            ],
            'days' => $days,
            'scans' => fn (): array => self::scans($code, $request, $days),
            'history' => fn (): array => self::history($code),
            'siblings' => fn (): array => $vehicle === null ? [] : array_values(QrCode::query()->where('vehicle_id', $vehicle->id)->whereKeyNot($code->id)
                ->orderByDesc('created_at')->orderByDesc('id')->get()
                ->map(fn (QrCode $other): array => ['id' => $other->id, 'display_code' => $codes->displayCode($other->code), 'status' => $other->status->value, 'created_at' => $other->created_at?->toIso8601String()])
                ->all()),
            'activity' => fn (): array => ActivityFeed::for(['qr_code' => [$code->id]], $staff),
        ]);
    }

    /**
     * One row per Berlin day, zeros included, oldest first.
     *
     * @return array{series: list<array{date: string, value: int}>, total: int}
     */
    private static function scans(QrCode $code, Request $request, int $days): array
    {
        $today = QaClock::today($request);
        $from = $today->subDays($days - 1);
        $counts = QrScanDaily::query()->where('qr_code_id', $code->id)->whereBetween('day', [$from->toDateString(), $today->toDateString()])
            ->pluck('count', 'day');

        $series = [];
        for ($day = $from; $day->lessThanOrEqualTo($today); $day = $day->addDay()) {
            $series[] = ['date' => $day->toDateString(), 'value' => (int) ($counts[$day->toDateString()] ?? 0)];
        }

        return ['series' => $series, 'total' => array_sum(array_column($series, 'value'))];
    }

    /**
     * created · revoked (with the stored reason) · reissued (staff or owner) · revoked by staff, newest first.
     *
     * @return list<array{kind: string, at: string|null, actor: string|null, reason: string|null, code: string|null}>
     */
    private static function history(QrCode $code): array
    {
        $events = AuditEvent::query()
            ->where(fn (Builder $q) => $q
                ->where(fn (Builder $t) => $t->where('target_type', 'qr_code')->where('target_id', $code->id))
                ->orWhere(fn (Builder $t) => $t->where('action', AdminMemberEvent::QrReissued->value)->where('target_type', 'vehicle')->where('target_id', (string) $code->vehicle_id)))
            ->orderByDesc('occurred_at')->orderByDesc('id')->limit(50)
            ->get(['id', 'occurred_at', 'actor_type', 'actor_id', 'action', 'reason', 'before', 'after']);

        $mapped = ActivityFeed::map(array_values($events->all()), true);
        $history = [];
        foreach ($events->values() as $index => $event) {
            $after = $event->getAttribute('after');
            $after = is_array($after) ? $after : [];
            $before = $event->getAttribute('before');
            $before = is_array($before) ? $before : [];
            $isReissue = $event->action === AdminMemberEvent::QrReissued->value;
            // A reissue concerns this code when it replaced it (from) or created it (to).
            if ($isReissue && ($after['from_qr_id'] ?? null) !== $code->id && ($after['code'] ?? null) !== $code->code && ($before['code'] ?? null) !== $code->code) {
                continue;
            }
            $history[] = [
                'kind' => $isReissue ? (($after['code'] ?? null) === $code->code ? 'issued_by_staff' : 'reissued_by_staff') : ($event->action === AdminMemberEvent::QrRevoked->value ? 'revoked_by_staff' : 'other'),
                'at' => $mapped[$index]['occurred_at'],
                'actor' => $mapped[$index]['actor'],
                'reason' => $event->reason,
                'code' => is_string($after['code'] ?? null) ? $after['code'] : null,
            ];
        }

        if ($code->getAttribute('revoked_at') !== null && ! collect($history)->contains(fn (array $h): bool => $h['kind'] === 'revoked_by_staff')) {
            $revokedAt = $code->getAttribute('revoked_at');
            $history[] = ['kind' => 'revoked', 'at' => $revokedAt instanceof \DateTimeInterface ? CarbonImmutable::instance($revokedAt)->toIso8601String() : null, 'actor' => null, 'reason' => ($reason = $code->getAttribute('revoked_reason')) instanceof QrRevocationReason ? $reason->value : null, 'code' => null];
        }
        $history[] = ['kind' => 'created', 'at' => $code->created_at?->toIso8601String(), 'actor' => null, 'reason' => null, 'code' => null];

        usort($history, fn (array $a, array $b): int => strcmp((string) $b['at'], (string) $a['at']));

        return $history;
    }
}
