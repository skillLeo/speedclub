<?php

namespace App\Services\Progress;

/**
 * M5.9d levels (m5.9d contract §1, §10.1): ten levels from "Street Rookie" to "Kaido Legend", each starting at the XP of
 * config `speedclub.xp.levels`; titles in lang/{de,en}/levels.php. No title names speed or racing on public roads ("Kaido" is the
 * mountain-road culture, never paired with speed wording).
 */
final class Levels
{
    /**
     * @return array{level: int, title: string, xp: int, next_level_xp: int|null, progress: float}
     */
    public function for(int $xp, ?string $locale = null): array
    {
        $xp = max(0, $xp);
        $thresholds = self::thresholds();
        $level = 1;

        foreach ($thresholds as $number => $from) {
            if ($xp >= $from) {
                $level = $number;
            }
        }

        $start = $thresholds[$level];
        $next = $thresholds[$level + 1] ?? null;
        $progress = $next === null ? 1.0 : round(($xp - $start) / max(1, $next - $start), 4);

        return ['level' => $level, 'title' => $this->title($level, $locale), 'xp' => $xp, 'next_level_xp' => $next, 'progress' => max(0.0, min(1.0, $progress))];
    }

    /**
     * The quiet `{level, title}` of profile resources (contract §10.5).
     *
     * @return array{level: int, title: string}
     */
    public function summary(int $xp, ?string $locale = null): array
    {
        $level = $this->for($xp, $locale);

        return ['level' => $level['level'], 'title' => $level['title']];
    }

    /**
     * Every level with its title and the XP where it starts, ascending (GET me/level `ladder`, client round 2: the level sheet shows
     * what comes next). Fixed rules from config, the same for every member.
     *
     * @return list<array{level: int, title: string, from_xp: int}>
     */
    public function ladder(?string $locale = null): array
    {
        $ladder = [];

        foreach (self::thresholds() as $level => $from) {
            $ladder[] = ['level' => $level, 'title' => $this->title($level, $locale), 'from_xp' => $from];
        }

        return $ladder;
    }

    public function title(int $level, ?string $locale = null): string
    {
        return (string) __('levels.titles.'.$level, [], $locale);
    }

    /**
     * Level => first XP, ascending, level 1 at 0.
     *
     * @return array<int, int>
     */
    public static function thresholds(): array
    {
        $levels = [];

        foreach (config()->array('speedclub.xp.levels') as $level => $from) {
            $levels[(int) $level] = max(0, (int) $from);
        }

        ksort($levels);
        $levels[1] = 0;

        return $levels;
    }
}
