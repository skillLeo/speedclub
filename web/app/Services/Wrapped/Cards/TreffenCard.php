<?php

namespace App\Services\Wrapped\Cards;

use App\Enums\EventStatus;
use App\Enums\EventVisibility;
use App\Enums\RsvpStatus;
use App\Services\Wrapped\WrappedContext;
use Illuminate\Database\Query\Builder;
use Illuminate\Support\Facades\DB;

/**
 * Card 6: meets the member attended in the season (contract §3). Attended = a "Zusagen" (going) answer the organiser did not remove,
 * for an organised event of Speedclub (status published: not cancelled, rejected or taken down) that started in the season and has
 * already taken place. There is no check-in yet, so the confirmed answer is the attendance. Names: at most `wrapped.max_meets` titles
 * of public events, newest first; followers-only and unlisted events count but are never named. Sample events count only for a
 * sample member. No other member is ever named.
 */
final class TreffenCard implements WrappedCard
{
    public function kind(): string
    {
        return 'treffen';
    }

    public function build(WrappedContext $context): ?array
    {
        $attended = (int) self::attended($context)->count();

        if ($attended === 0) {
            return null;
        }

        $names = self::attended($context)
            ->where('e.visibility', EventVisibility::Public->value)
            ->orderByDesc('e.starts_at')
            ->orderByDesc('e.id')
            ->limit(config()->integer('speedclub.wrapped.max_meets'))
            ->pluck('e.title')
            ->map(fn (mixed $title): string => trim((string) $title))
            ->filter(fn (string $title): bool => $title !== '')
            ->values()
            ->all();

        return ['kind' => 'treffen', 'attended' => $attended, 'names' => $names];
    }

    /**
     * The member's attended events of the season (as e), also read by the Build Spirit's Track-Day rule.
     */
    public static function attended(WrappedContext $context): Builder
    {
        $now = $context->now->utc();

        return DB::table('event_rsvps as r')
            ->join('events as e', 'e.id', '=', 'r.event_id')
            ->where('r.user_id', $context->member->id)
            ->where('r.status', RsvpStatus::Going->value)
            ->whereNull('r.removed_at')
            ->where('e.status', EventStatus::Published->value)
            ->whereNull('e.removed_at')
            ->whereNull('e.cancelled_at')
            ->where('e.starts_at', '>=', $context->season->fromUtc())
            ->where('e.starts_at', '<=', $context->untilUtc())
            ->whereRaw('COALESCE(e.ends_at, e.starts_at) < ?', [$now->format('Y-m-d H:i:s')])
            ->when(! $context->isSample(), fn (Builder $query) => $query->where('e.is_sample', false));
    }
}
