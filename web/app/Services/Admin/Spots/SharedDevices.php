<?php

namespace App\Services\Admin\Spots;

use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Schema;

/**
 * ADM-62 "Gleiches Gerät": spotting accounts that signed in on one app install. Every other stored install hash is keyed with the member
 * (ADR-435: device_installs.install_id_hash, personal_access_tokens.device_id, push_tokens.device_id), so two accounts of one phone share
 * no value there on purpose. ADR-511 adds `device_installs.install_key` (DeviceInstalls::installKey, app key only), written at each
 * sign-in and token rotation; this class is its only reader. available() stays as a guard for a database before that migration (the
 * page then says the signal is not recorded yet). Keys never leave this class: a caller gets member ids and counts only.
 */
class SharedDevices
{
    private ?bool $available = null;

    public function available(): bool
    {
        return $this->available ??= Schema::hasTable('device_installs') && Schema::hasColumn('device_installs', 'install_key');
    }

    /**
     * Spotters who share an install with at least one other account that has spotted, with how many other accounts that are.
     *
     * @param  list<string>|null  $among  only these spotters (null = all)
     * @return array<string, int> spotter id => other accounts
     */
    public function spotters(?array $among = null): array
    {
        if (! $this->available() || $among === []) {
            return [];
        }

        $spotters = DB::table('spots')->select('spotter_id');
        $shared = DB::table('device_installs')->whereNotNull('install_key')->whereIn('user_id', $spotters)
            ->groupBy('install_key')->havingRaw('COUNT(DISTINCT user_id) > 1')->select('install_key');

        $rows = DB::table('device_installs as d')
            ->joinSub($shared, 'k', 'k.install_key', '=', 'd.install_key')
            ->whereIn('d.user_id', DB::table('spots')->select('spotter_id'))
            ->select(['d.user_id', 'd.install_key'])
            ->distinct()
            ->get();

        /** @var array<string, list<string>> $byKey */
        $byKey = [];
        foreach ($rows as $row) {
            $byKey[(string) $row->install_key][] = (string) $row->user_id;
        }

        /** @var array<string, array<string, true>> $others */
        $others = [];
        foreach ($byKey as $users) {
            foreach ($users as $user) {
                foreach ($users as $other) {
                    if ($other !== $user) {
                        $others[$user][$other] = true;
                    }
                }
            }
        }

        $counts = array_map(count(...), $others);

        return $among === null ? $counts : array_intersect_key($counts, array_flip($among));
    }
}
