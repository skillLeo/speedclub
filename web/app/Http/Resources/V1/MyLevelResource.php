<?php

namespace App\Http\Resources\V1;

use Illuminate\Http\Request;
use Illuminate\Http\Resources\Json\JsonResource;

/**
 * GET me/level (m5.9d contract §1, §10.1): the member's level, title, XP, the XP where the next level starts (null on the top level),
 * the way there (0–1), today's XP against the daily cap, and the fixed rules (`daily_max`: a per-type maximum of XP a day, null for
 * none), and the ladder of all levels. Nothing for likes, posting volume or signing in.
 *
 * @property array{level: int, title: string, xp: int, next_level_xp: int|null, progress: float, today: array{earned: int, cap: int}, rules: list<array{type: string, points: int, daily_max: int|null}>, ladder: list<array{level: int, title: string, from_xp: int}>} $resource
 */
class MyLevelResource extends JsonResource
{
    /**
     * @return array<string, mixed>
     */
    public function toArray(Request $request): array
    {
        return [
            /** 1–10. */
            'level' => (int) $this->resource['level'],
            /** "Street Rookie" … "Kaido Legend", in the request's language. */
            'title' => (string) $this->resource['title'],
            'xp' => (int) $this->resource['xp'],
            /**
             * The XP at which the next level starts; null on level 10.
             *
             * @var int|null
             */
            'next_level_xp' => $this->resource['next_level_xp'],
            /** 0–1 on the way to the next level; 1 on the top level. */
            'progress' => (float) $this->resource['progress'],
            /**
             * XP of the Europe/Berlin day and the daily cap.
             *
             * @var array{earned: int, cap: int}
             */
            'today' => $this->resource['today'],
            /**
             * The XP rules: type (first_vehicle, documented_mod, build_update, new_spot, set_completed, event_checkin, forum_solution,
             * helpful_received), points, and the most XP the type earns a day (null: only the daily cap).
             *
             * @var list<array{type: string, points: int, daily_max: int|null}>
             */
            'rules' => $this->resource['rules'],
            /**
             * Every level 1–10 with its title (request language) and the XP where it starts, ascending: what comes next. Levels
             * unlock titles only, no features.
             *
             * @var list<array{level: int, title: string, from_xp: int}>
             */
            'ladder' => $this->resource['ladder'],
        ];
    }
}
