<?php

namespace App\Services\Insights;

use Illuminate\Support\Facades\DB;

/**
 * M5.7 (m5.7-contract §1.1, §2.2): the secret key of the viewer hash, one per Europe/Berlin day. The first view of a day creates it
 * (insertOrIgnore, so two writers at the same moment agree on one) and deletes the keys of the days before; views:prune deletes them too.
 * Once a day's key is gone, nobody can recompute or link a hash stored with that day. Never logged, exported or shown.
 */
final class ViewSalts
{
    /** @var array<string, string> day => salt, for this process */
    private array $memo = [];

    public function forDay(string $day): string
    {
        if (isset($this->memo[$day])) {
            return $this->memo[$day];
        }

        $created = DB::table('view_salts')->insertOrIgnore([
            'day' => $day,
            'salt' => bin2hex(random_bytes(32)),
            'created_at' => now(),
        ]);

        if ($created === 1) {
            $this->pruneBefore($day);
        }

        $salt = (string) DB::table('view_salts')->where('day', $day)->value('salt');
        $this->memo = [$day => $salt];

        return $salt;
    }

    /**
     * Deletes the keys of every day before $day; returns how many.
     */
    public function pruneBefore(string $day): int
    {
        $this->memo = array_intersect_key($this->memo, [$day => true]);

        return DB::table('view_salts')->where('day', '<', $day)->delete();
    }
}
