<?php

namespace App\Services\Home;

use App\Models\User;
use App\Models\Vehicle;
use App\Services\Discover\VisibleBuilds;
use Carbon\CarbonImmutable;
use Illuminate\Support\Facades\Cache;
use Illuminate\Support\Str;

/**
 * "Build der Woche" (09 §7.3 HOME-01 module): one build per ISO week, the same for everybody: the best-ranked public builds changed in the
 * two weeks before the week began, kept for the week. Each reader gets the first of them they may see (blocks, private builds and hidden
 * samples drop out through VisibleBuilds) that is not the hero above. The quote is the owner's own first sentence of the description, or
 * null; the app shows nothing invented.
 */
final class BuildOfWeek
{
    private const CANDIDATES = 10;

    private const QUOTE_MAX = 140;

    public function __construct(
        private readonly VisibleBuilds $builds,
        private readonly HomeRanking $ranking,
    ) {}

    /**
     * @param  list<string>  $except  vehicle ids already on the page (the hero)
     * @return array{vehicle: Vehicle, quote: string|null, week: string}|null
     */
    public function for(?User $viewer, array $except = []): ?array
    {
        $now = CarbonImmutable::now(config()->string('speedclub.notifications.timezone'));
        $week = $now->isoFormat('GGGG-[W]WW');
        $start = $now->startOfWeek(CarbonImmutable::MONDAY);
        $column = HomeRanking::column($this->ranking->state()['epoch']);

        /** @var list<string> $candidates */
        $candidates = Cache::remember('home.build_of_week.'.$week, now()->addDays(8), fn (): array => $this->builds->query(null)
            ->where(VisibleBuilds::CHANGED_AT, '>=', $start->subWeeks(2)->utc())
            ->where(VisibleBuilds::CHANGED_AT, '<', $start->utc())
            ->orderByDesc('vs.'.$column)
            ->orderByDesc('vs.vehicle_id')
            ->limit(self::CANDIDATES)
            ->pluck('vs.vehicle_id')
            ->map(strval(...))
            ->all());

        $candidates = array_values(array_diff($candidates, $except));

        if ($candidates === []) {
            return null;
        }

        $visible = $this->builds->query($viewer, fromSearch: false)->whereIn('vs.vehicle_id', $candidates)->pluck('vs.vehicle_id')->map(strval(...))->all();
        $pick = array_values(array_intersect($candidates, $visible))[0] ?? null;
        $vehicle = $pick === null ? null : ($this->builds->vehicles([$pick])[$pick] ?? null);

        return $vehicle instanceof Vehicle ? ['vehicle' => $vehicle, 'quote' => self::quote($vehicle), 'week' => $week] : null;
    }

    /**
     * The first sentence of the owner's description, at most QUOTE_MAX characters; null without one.
     */
    public static function quote(Vehicle $vehicle): ?string
    {
        $text = trim((string) $vehicle->getAttribute('description'));

        if ($text === '') {
            return null;
        }

        $sentence = preg_split('/(?<=[.!?])\s+/u', $text, 2)[0] ?? $text;

        return Str::limit(trim($sentence), self::QUOTE_MAX, '…');
    }
}
