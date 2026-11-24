<?php

namespace App\Services\Wrapped\Cards;

use App\Enums\Bundesland;
use App\Enums\UserStatus;
use App\Enums\VehicleStatus;
use App\Enums\Visibility;
use App\Services\BuildScore\BuildScores;
use App\Services\Wrapped\PercentileGroups;
use App\Services\Wrapped\WrappedContext;
use Illuminate\Database\Query\Builder;
use Illuminate\Support\Facades\DB;

/**
 * Card 8: where the member's best Build Score stands among the members of their Bundesland (contract §3). The group: members of the
 * same `users.bundesland` with a car that may be ranked (published, public, not ghost, owner active and verified; M5.9c's rule), each
 * with their best total. Only with at least `wrapped.percentile.min_members` members, only when the member's own best car may be ranked,
 * and only within the top `wrapped.percentile.max_top` per cent: a low place is left out, never shown. Top % = members with a higher
 * total + 1, over the group, rounded up. Samples: never in a real member's group; a sample member (staging demo only) is compared with
 * real and sample members alike, as samples never rank among themselves (M5.9c). The group's totals are read once per Bundesland per
 * generation pass (PercentileGroups, CR-P5G-05).
 */
final class PercentileCard implements WrappedCard
{
    public function __construct(private readonly PercentileGroups $groups) {}

    public function kind(): string
    {
        return 'percentile';
    }

    public function build(WrappedContext $context): ?array
    {
        $bundesland = $context->member->getAttribute('bundesland');

        if (! $bundesland instanceof Bundesland) {
            return null;
        }

        $own = $context->publishedCars()
            ->filter(fn ($car): bool => ($context->isSample() || BuildScores::rankable($car->setRelation('owner', $context->member))) && $car->buildScore !== null && ! $car->ghost_mode && $car->visibility === Visibility::Public)
            ->map(fn ($car): int => (int) $car->buildScore?->total)
            ->max();

        if (! is_int($own) || $own <= 0) {
            return null;
        }

        $totals = $this->groups->totals($bundesland->value.'|'.($context->isSample() ? 'sample' : 'real'), fn (): array => array_values(
            $this->group($context, $bundesland)->pluck('best')->map(fn (mixed $best): int => (int) $best)->sortDesc()->values()->all(),
        ));
        $members = count($totals);

        if ($members < config()->integer('speedclub.wrapped.percentile.min_members')) {
            return null;
        }

        $higher = count(array_filter($totals, fn (int $best): bool => $best > $own));
        $top = max(1, (int) ceil(($higher + 1) * 100 / $members));

        if ($top > config()->integer('speedclub.wrapped.percentile.max_top')) {
            return null;
        }

        return ['kind' => 'percentile', 'bundesland' => $bundesland->value, 'top' => $top, 'members' => $members, 'metric' => 'build_score'];
    }

    /**
     * One row per member of the Bundesland with a rankable car: their best total. The member is in it with the same rule.
     */
    private function group(WrappedContext $context, Bundesland $bundesland): Builder
    {
        return DB::table('vehicles as v')
            ->join('users as o', 'o.id', '=', 'v.owner_id')
            ->join('build_scores as b', 'b.vehicle_id', '=', 'v.id')
            ->whereNull('v.deleted_at')
            ->where('v.status', VehicleStatus::Published->value)
            ->where('v.visibility', Visibility::Public->value)
            ->where('v.ghost_mode', false)
            ->whereNull('o.deleted_at')
            ->where('o.status', UserStatus::Active->value)
            ->whereNotNull('o.email_verified_at')
            ->where('o.bundesland', $bundesland->value)
            ->when(! $context->isSample(), fn (Builder $query) => $query->where('v.is_sample', false)->where('o.is_sample', false))
            ->groupBy('o.id')
            ->selectRaw('o.id as member_id, MAX(b.total) as best');
    }
}
