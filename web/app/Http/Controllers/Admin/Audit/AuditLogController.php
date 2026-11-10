<?php

namespace App\Http\Controllers\Admin\Audit;

use App\Console\Commands\AuditVerifyCommand;
use App\Enums\AuditActorType;
use App\Http\Controllers\Admin\Support\TableProps;
use App\Http\Controllers\Controller;
use App\Models\AuditEvent;
use App\Models\Staff;
use App\Models\User;
use App\Services\Audit\Audit;
use Illuminate\Database\Eloquent\Builder;
use Illuminate\Http\Request;
use Illuminate\Support\Carbon;
use Illuminate\Support\Facades\Cache;
use Inertia\Inertia;
use Inertia\Response;
use Spatie\QueryBuilder\AllowedFilter;
use Spatie\QueryBuilder\QueryBuilder;

/**
 * ADM-44 audit log: filters actor, action, target and date range; event drawer with the before/after diff (opening an event is
 * itself audited, before/after may hold personal data); chain status from the last audit:verify run.
 * Staff IP and user agent (audit_event_access) are never shown here.
 */
class AuditLogController extends Controller
{
    public const TABLE = 'audit';

    public function __invoke(Request $request): Response
    {
        /** @var Staff $staff */
        $staff = $request->user('staff');

        $query = QueryBuilder::for(AuditEvent::query(), $request)
            ->allowedFilters(
                AllowedFilter::callback('actor', function (Builder $query, mixed $value): void {
                    $value = is_string($value) ? $value : '';
                    [$type, $id] = array_pad(explode(':', $value, 2), 2, null);

                    $query->where('actor_type', AuditActorType::tryFrom($type ?? '')->value ?? '-');
                    if ($id !== null && $id !== '') {
                        $query->where('actor_id', $id);
                    }
                })->delimiter("\u{1}"),
                AllowedFilter::beginsWith('action')->delimiter("\u{1}"),
                AllowedFilter::exact('target_type')->delimiter("\u{1}"),
                AllowedFilter::exact('target_id')->delimiter("\u{1}"),
                AllowedFilter::callback('from', fn (Builder $query, mixed $value) => $query->where('occurred_at', '>=', self::day($value)->startOfDay()->utc()))->delimiter("\u{1}"),
                AllowedFilter::callback('to', fn (Builder $query, mixed $value) => $query->where('occurred_at', '<=', self::day($value)->endOfDay()->utc()))->delimiter("\u{1}"),
            )
            ->allowedSorts('occurred_at', 'action')
            ->defaultSort('-occurred_at');

        return Inertia::render('Audit/Index', [
            ...TableProps::make($query, $request, self::TABLE, $staff, fn (array $events): array => self::rows($events), '-occurred_at'),
            'chain' => self::chain(),
            'actors' => fn (): array => Staff::query()->orderBy('name')->get(['id', 'name'])
                ->map(fn (Staff $s): array => ['value' => 'staff:'.$s->id, 'label' => $s->name])->values()->all(),
            'targetTypes' => fn (): array => AuditEvent::query()->whereNotNull('target_type')->distinct()->orderBy('target_type')
                ->limit(100)->pluck('target_type')->filter(fn (mixed $t): bool => is_string($t))->values()->all(),
            'selected' => fn (): ?array => self::selected($request, $staff),
            'canExport' => $staff->can('audit.export'),
        ]);
    }

    private static function day(mixed $value): Carbon
    {
        $value = is_string($value) && preg_match('/^\d{4}-\d{2}-\d{2}$/', $value) === 1 ? $value : 'today';

        return Carbon::parse($value, 'Europe/Berlin');
    }

    /**
     * @param  list<AuditEvent>  $events
     * @return list<array<string, mixed>>
     */
    private static function rows(array $events): array
    {
        $labels = self::actorLabels($events);

        return array_map(fn (AuditEvent $event): array => [
            'id' => $event->id,
            'occurred_at' => Carbon::parse(self::raw($event, 'occurred_at'), 'UTC')->toIso8601String(),
            'actor' => self::actor($event, $labels),
            'action' => $event->action,
            'target' => $event->target_type === null ? null : ['type' => $event->target_type, 'id' => $event->target_id],
            'reason' => $event->reason,
            'has_diff' => $event->before !== null || $event->after !== null,
        ], $events);
    }

    /**
     * @param  list<AuditEvent>  $events
     * @return array<string, string>
     */
    private static function actorLabels(array $events): array
    {
        $ids = fn (AuditActorType $type): array => array_values(array_unique(array_filter(array_map(
            fn (AuditEvent $e): string => self::raw($e, 'actor_type') === $type->value ? self::raw($e, 'actor_id') : '',
            $events,
        ), fn (string $id): bool => $id !== '')));

        $labels = [];
        foreach (Staff::query()->whereIn('id', $ids(AuditActorType::Staff))->get(['id', 'name']) as $staff) {
            $labels['staff:'.$staff->id] = $staff->name;
        }
        foreach (User::query()->whereIn('id', $ids(AuditActorType::Member))->get(['id', 'username']) as $user) {
            $labels['member:'.$user->id] = $user->username === null ? '' : '@'.$user->username;
        }

        return $labels;
    }

    /**
     * @param  array<string, string>  $labels
     * @return array{type: string, id: string|null, label: string|null}
     */
    private static function actor(AuditEvent $event, array $labels): array
    {
        $type = AuditActorType::tryFrom(self::raw($event, 'actor_type'))->value ?? AuditActorType::System->value;
        $id = self::raw($event, 'actor_id');
        $label = $labels[$type.':'.$id] ?? null;

        return ['type' => $type, 'id' => $id === '' ? null : $id, 'label' => $label === '' || $label === null ? null : $label];
    }

    /**
     * The stored column value. The model has no property docs, so the raw value is the one with a known type here.
     */
    private static function raw(AuditEvent $event, string $column): string
    {
        $value = $event->getRawOriginal($column);

        return is_scalar($value) ? (string) $value : '';
    }

    /**
     * @return array{intact: bool, checked: int, broken_at: int|null, verified_at: string|null}|null
     */
    private static function chain(): ?array
    {
        $result = Cache::get(AuditVerifyCommand::RESULT_CACHE_KEY);

        if (! is_array($result)) {
            return null;
        }

        return [
            'intact' => ($result['intact'] ?? false) === true,
            'checked' => is_int($result['checked'] ?? null) ? $result['checked'] : 0,
            'broken_at' => is_int($result['broken_at'] ?? null) ? $result['broken_at'] : null,
            'verified_at' => is_string($result['verified_at'] ?? null) ? $result['verified_at'] : null,
        ];
    }

    /**
     * @return array<string, mixed>|null
     */
    private static function selected(Request $request, Staff $staff): ?array
    {
        $id = $request->query('event');

        if (! is_string($id) || preg_match('/^\d{1,20}$/', $id) !== 1) {
            return null;
        }

        $event = AuditEvent::query()->find((int) $id);

        if (! $event instanceof AuditEvent) {
            return ['id' => (int) $id, 'missing' => true];
        }

        Audit::record('audit.event_viewed', $event, actor: $staff);

        return [
            ...self::rows([$event])[0],
            'before' => $event->before,
            'after' => $event->after,
            'request_id' => $event->request_id,
            'hash' => $event->hash,
            'missing' => false,
        ];
    }
}
