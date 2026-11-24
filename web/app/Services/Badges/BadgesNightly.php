<?php

namespace App\Services\Badges;

use App\Models\Badge;
use Carbon\CarbonImmutable;
use Illuminate\Database\Eloquent\Collection;
use Illuminate\Support\Facades\Cache;
use Illuminate\Support\Facades\DB;

/**
 * The retroactive badge run (m5.9d contract §2): badges:nightly every ten minutes 03:05–05:55 Europe/Berlin (after the Build Score and
 * Dex nights wrote their totals) walks every member by id in chunks of `badges.chunk` and awards what they reached (no push: the toast
 * shows it in the app). Resumable: a run stops after `badges.seconds` and keeps the last id in the cache under the Berlin date; a lost
 * state only means the walk starts again, which awards nothing twice. A cache lock keeps two runs apart.
 *
 * walk() is shared with the admin's "Jetzt anwenden" (ApplyBadgeSlice) for one badge.
 */
final class BadgesNightly
{
    public const LOCK = 'badges:nightly:lock';

    public function __construct(private readonly BadgeAwarder $awarder) {}

    /**
     * @return array{done: bool, members: int, awarded: int}|null null while another run holds the lock
     */
    public function run(?CarbonImmutable $now = null): ?array
    {
        $lock = Cache::lock(self::LOCK, 120);

        if (! $lock->get()) {
            return null;
        }

        try {
            $key = self::stateKey($now ?? CarbonImmutable::now());
            /** @var array{cursor?: string|null, done?: bool}|null $state */
            $state = Cache::get($key);

            if (($state['done'] ?? false) === true) {
                return ['done' => true, 'members' => 0, 'awarded' => 0];
            }

            $result = $this->walk($this->awarder->activeBadges(), $state['cursor'] ?? null, 'nightly');
            Cache::put($key, ['cursor' => $result['cursor'], 'done' => $result['cursor'] === null], now()->addDays(2));

            return ['done' => $result['cursor'] === null, 'members' => $result['members'], 'awarded' => $result['awarded']];
        } finally {
            $lock->release();
        }
    }

    public static function stateKey(CarbonImmutable $now): string
    {
        return 'badges:nightly:'.$now->setTimezone(config()->string('speedclub.notifications.timezone'))->toDateString();
    }

    /**
     * Members after $cursor in chunks until the time budget is used. Returns the cursor to continue at (null when every member is done).
     *
     * @param  Collection<int, Badge>  $badges
     * @return array{cursor: string|null, members: int, awarded: int}
     */
    public function walk(Collection $badges, ?string $cursor, string $source): array
    {
        $deadline = microtime(true) + config()->integer('speedclub.badges.seconds');
        $chunk = max(1, config()->integer('speedclub.badges.chunk'));
        $members = 0;
        $awarded = 0;

        while (true) {
            $ids = DB::table('users')
                ->whereNull('deleted_at')
                ->when($cursor !== null, fn ($query) => $query->where('id', '>', $cursor))
                ->orderBy('id')
                ->limit($chunk)
                ->pluck('id')
                ->map(strval(...))
                ->all();

            if ($ids === []) {
                return ['cursor' => null, 'members' => $members, 'awarded' => $awarded];
            }

            foreach ($this->awarder->evaluateMany(array_values($ids), $badges, $source, false) as $keys) {
                $awarded += count($keys);
            }

            $members += count($ids);
            $cursor = end($ids);

            if (count($ids) < $chunk) {
                return ['cursor' => null, 'members' => $members, 'awarded' => $awarded];
            }

            if (microtime(true) > $deadline) {
                return ['cursor' => $cursor, 'members' => $members, 'awarded' => $awarded];
            }
        }
    }
}
