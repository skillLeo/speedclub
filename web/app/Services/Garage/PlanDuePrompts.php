<?php

namespace App\Services\Garage;

use App\Enums\ModPriority;
use App\Enums\ModStatus;
use App\Models\Modification;
use App\Models\User;
use App\Services\AppConfig\FeatureFlags;
use App\Services\Insights\EngagementCounters;
use App\Services\Notifications\Notifier;
use Carbon\CarbonImmutable;
use Carbon\CarbonInterface;
use Illuminate\Database\Query\Builder;
use Illuminate\Support\Facades\Cache;
use Illuminate\Support\Facades\DB;
use Throwable;

/**
 * M5.7 build prompts (10 §6.2, m5.7-contract §4.2), run by plans:due-prompts every ten minutes from 10:00 to 11:55 Europe/Berlin: when a
 * planned mod's target month has arrived (this month or last month — an older plan is never dug up), the owner is asked once "Ist das
 * KW V3 schon verbaut? Trag es ein." At most one prompt per owner in 7 days, the in-app row included; of several due mods the one with the
 * highest priority, then the earliest month, then the owner's plan order. The others wait for a later week.
 *
 * Idempotent: `plan_prompted_for` = the target month asked about (a plan moved to a later month is asked about once more), the 7-day guard
 * and the row's unique group key. Owners in id order; the cursor (cache, per Berlin day) lets a cut-off run continue, `seconds` bound a
 * run, a cache lock keeps two runs apart. Only real, reachable owners (Notifier checks reach and the SET-09 switch "Build-Erinnerungen").
 */
final class PlanDuePrompts
{
    public const FLAG = 'build_prompts';

    public const LOCK = 'plans:due-prompts:lock';

    private const CHUNK = 200;

    public function __construct(
        private readonly Notifier $notifier,
        private readonly FeatureFlags $flags,
    ) {}

    /**
     * @return int|null owners asked, null while another run holds the lock
     */
    public function run(?CarbonImmutable $now = null): ?int
    {
        if (! $this->flags->enabled(self::FLAG)) {
            return 0;
        }

        $lock = Cache::lock(self::LOCK, 120);

        if (! $lock->get()) {
            return null;
        }

        try {
            return $this->send($now ?? CarbonImmutable::now());
        } finally {
            $lock->release();
        }
    }

    private function send(CarbonImmutable $now): int
    {
        $zone = config()->string('speedclub.notifications.timezone');
        $local = $now->setTimezone($zone);
        $month = $local->startOfMonth();
        $months = [$month->toDateString(), $month->subMonthNoOverflow()->toDateString()];
        $cursorKey = 'plans:due-prompts:cursor:'.$local->toDateString();
        $after = Cache::get($cursorKey);
        $deadline = microtime(true) + config()->integer('speedclub.build_prompts.seconds', 40);
        $asked = 0;

        do {
            $owners = $this->owners($months, is_string($after) ? $after : null);

            foreach ($owners as $ownerId) {
                $after = $ownerId;

                try {
                    $asked += $this->ask($ownerId, $months, $now);
                } catch (Throwable $exception) {
                    report($exception);
                }

                Cache::put($cursorKey, $after, now()->addDays(2));

                if (microtime(true) > $deadline) {
                    return $asked;
                }
            }
        } while (count($owners) === self::CHUNK);

        return $asked;
    }

    /**
     * Owners (in id order after $after) with a due, not yet asked plan of a car that is not deleted.
     *
     * @param  list<string>  $months
     * @return list<string>
     */
    private function owners(array $months, ?string $after): array
    {
        $since = CarbonImmutable::now()->subDays(config()->integer('speedclub.build_prompts.every_days', 7));

        return array_values($this->due($months)
            ->where(fn ($recent) => $recent->whereNull('u.plan_prompted_at')->orWhere('u.plan_prompted_at', '<=', $since))
            ->when($after !== null, fn ($query) => $query->where('v.owner_id', '>', $after))
            ->distinct()
            ->orderBy('v.owner_id')
            ->limit(self::CHUNK)
            ->pluck('v.owner_id')
            ->map(strval(...))
            ->all());
    }

    /**
     * @param  list<string>  $months
     */
    private function due(array $months): Builder
    {
        return DB::table('modifications', 'm')
            ->join('vehicles as v', 'v.id', '=', 'm.vehicle_id')
            ->join('users as u', 'u.id', '=', 'v.owner_id')
            ->where('m.status', ModStatus::Planned->value)
            ->whereNull('m.deleted_at')
            ->whereNull('v.deleted_at')
            ->whereIn('m.target_month', $months)
            ->where(fn ($asked) => $asked->whereNull('m.plan_prompted_for')->orWhereColumn('m.plan_prompted_for', '!=', 'm.target_month'))
            ->where('u.is_sample', false)
            ->where('v.is_sample', false);
    }

    /**
     * @param  list<string>  $months
     * @return int 1 when the owner was asked
     */
    private function ask(string $ownerId, array $months, CarbonImmutable $now): int
    {
        $owner = User::query()->find($ownerId);

        if (! $owner instanceof User) {
            return 0;
        }

        // MF-1 (review M5.6/M5.7): the 7-day limit reads the owner's own column, which outlives the in-app row (installing or deleting
        // the plan removes that row, Notifier::forgetPlanDue).
        $last = $owner->getAttribute('plan_prompted_at');

        if ($last instanceof CarbonInterface && $last->greaterThan($now->subDays(config()->integer('speedclub.build_prompts.every_days', 7)))) {
            return 0;
        }

        $rank = array_flip([ModPriority::High->value, ModPriority::Normal->value, ModPriority::Low->value]);
        /** @var Modification|null $mod */
        $mod = Modification::query()
            ->whereIn('id', $this->due($months)->where('v.owner_id', $ownerId)->select('m.id'))
            ->with(['vehicle.make', 'vehicle.vehicleModel', 'vehicle.generation', 'brand'])
            ->get()
            ->sortBy(fn (Modification $mod): array => [
                $rank[(string) $mod->getRawOriginal('priority')] ?? 3,
                (string) $mod->getRawOriginal('target_month'),
                (int) $mod->getAttribute('plan_sort'),
                $mod->id,
            ])
            ->first();

        if ($mod === null) {
            return 0;
        }

        $row = $this->notifier->planDue($owner, $mod->vehicle, $mod);
        Modification::query()->whereKey($mod->id)->toBase()->update(['plan_prompted_for' => $mod->getRawOriginal('target_month')]);

        if ($row !== null) {
            User::query()->whereKey($owner->id)->toBase()->update(['plan_prompted_at' => $now->utc()]);
            // ADM-70 Insights overview: the platform count of prompts sent (the row itself goes once the mod is installed).
            EngagementCounters::bump(EngagementCounters::PLAN_PROMPT);
        }

        return $row === null ? 0 : 1;
    }
}
