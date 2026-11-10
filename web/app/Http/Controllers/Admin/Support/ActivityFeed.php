<?php

namespace App\Http\Controllers\Admin\Support;

use App\Enums\AuditActorType;
use App\Models\AuditEvent;
use App\Models\Staff;
use App\Models\User;
use Illuminate\Database\Eloquent\Builder;
use Illuminate\Support\Carbon;

/**
 * The right-hand activity of a record page (03 §14: "activity timeline from the audit log"): audit events whose target is one of the
 * given records, newest first (tie-break on the id). The reason is part of an entry only for staff who may read the audit log; never
 * before/after, IP or user agent.
 */
final class ActivityFeed
{
    /**
     * @param  array<string, list<string>>  $targets  target_type => ids
     * @return list<array{id: int, occurred_at: string, action: string, actor: string|null, actor_type: string, actor_id: string|null, reason: string|null}>
     */
    public static function for(array $targets, Staff $viewer, int $limit = 30, ?User $actorMember = null): array
    {
        $targets = array_filter($targets, fn (array $ids): bool => $ids !== []);

        if ($targets === [] && $actorMember === null) {
            return [];
        }

        $events = AuditEvent::query()
            ->where(function (Builder $query) use ($targets, $actorMember): void {
                foreach ($targets as $type => $ids) {
                    $query->orWhere(fn (Builder $q) => $q->where('target_type', $type)->whereIn('target_id', $ids));
                }
                if ($actorMember !== null) {
                    $query->orWhere(fn (Builder $q) => $q->where('actor_type', AuditActorType::Member->value)->where('actor_id', $actorMember->id));
                }
            })
            ->orderByDesc('occurred_at')
            ->orderByDesc('id')
            ->limit($limit)
            ->get(['id', 'occurred_at', 'actor_type', 'actor_id', 'action', 'reason']);

        return self::map(array_values($events->all()), $viewer->can('audit.view'));
    }

    /**
     * @param  list<AuditEvent>  $events
     * @return list<array{id: int, occurred_at: string, action: string, actor: string|null, actor_type: string, actor_id: string|null, reason: string|null}>
     */
    public static function map(array $events, bool $withReasons): array
    {
        $raw = fn (AuditEvent $event, string $column): string => is_scalar($value = $event->getRawOriginal($column)) ? (string) $value : '';
        $ids = fn (AuditActorType $type): array => array_values(array_unique(array_filter(array_map(
            fn (AuditEvent $e): string => $raw($e, 'actor_type') === $type->value ? $raw($e, 'actor_id') : '',
            $events,
        ))));

        $labels = [];
        foreach (Staff::query()->whereIn('id', $ids(AuditActorType::Staff))->get(['id', 'name']) as $staff) {
            $labels['staff:'.$staff->id] = $staff->name;
        }
        foreach (User::withTrashed()->whereIn('id', $ids(AuditActorType::Member))->get(['id', 'username']) as $user) {
            $labels['member:'.$user->id] = $user->username === null ? null : '@'.$user->username;
        }

        return array_map(fn (AuditEvent $event): array => [
            'id' => (int) $event->getKey(),
            'occurred_at' => Carbon::parse($raw($event, 'occurred_at'), 'UTC')->toIso8601String(),
            'action' => $event->action,
            'actor' => $labels[$raw($event, 'actor_type').':'.$raw($event, 'actor_id')] ?? null,
            'actor_type' => $raw($event, 'actor_type'),
            'actor_id' => $raw($event, 'actor_id') === '' ? null : $raw($event, 'actor_id'),
            'reason' => $withReasons ? $event->reason : null,
        ], $events);
    }
}
