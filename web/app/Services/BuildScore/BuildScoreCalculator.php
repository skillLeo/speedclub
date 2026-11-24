<?php

namespace App\Services\BuildScore;

/**
 * The Build Score formula (10 §16.3, owner gift detail M5.9c), pure: config `speedclub.build_score` in, points out. Four parts —
 * completeness 300, documentation 300, community 250, journey 150 — of items that give `points` per unit for at most `limit` units
 * (once for a one-off item). Stages 1–5 from the configured starts. "Nächstes Upgrade" lists what the owner can still add, never the
 * community items (nobody is asked to chase reactions) and never the history span (it grows with time).
 *
 * @phpstan-type Item array{key: string, points: int, limit: int|null, max: int, min_chars?: int}
 * @phpstan-type Part array{key: string, max: int, items: list<Item>}
 * @phpstan-type Result array{total: int, stage: int, parts: array<string, array{points: int, max: int}>, breakdown: array<string, array{points: int, max: int, have: int}>}
 * @phpstan-type Upgrade array{key: string, label_key: string, points: int, progress: array{have: int, need: int}}
 */
final class BuildScoreCalculator
{
    public const PARTS = ['completeness', 'documentation', 'community', 'journey'];

    /**
     * @param  array<string, mixed>|null  $config  build_score config; null reads config/speedclub.php
     */
    public function __construct(private ?array $config = null) {}

    /**
     * @return list<Part>
     */
    public function parts(): array
    {
        /** @var array<string, array<string, array{points: int, limit: int|null, min_chars?: int}>> $parts */
        $parts = $this->config()['parts'];
        $result = [];

        foreach (self::PARTS as $part) {
            $items = [];

            foreach ($parts[$part] ?? [] as $key => $item) {
                $points = (int) $item['points'];
                $limit = $item['limit'] === null ? null : (int) $item['limit'];
                $entry = ['key' => $key, 'points' => $points, 'limit' => $limit, 'max' => $points * ($limit ?? 1)];

                if (isset($item['min_chars'])) {
                    $entry['min_chars'] = (int) $item['min_chars'];
                }

                $items[] = $entry;
            }

            $result[] = ['key' => $part, 'max' => array_sum(array_column($items, 'max')), 'items' => $items];
        }

        return $result;
    }

    /**
     * @return Result
     */
    public function calculate(BuildScoreFacts $facts): array
    {
        $units = $facts->units($this->descriptionMinChars());
        $parts = [];
        $breakdown = [];

        foreach ($this->parts() as $part) {
            $points = 0;

            foreach ($part['items'] as $item) {
                $have = max(0, $units[$item['key']] ?? 0);
                $earned = min($have, $item['limit'] ?? 1) * $item['points'];
                $breakdown[$item['key']] = ['points' => $earned, 'max' => $item['max'], 'have' => $have];
                $points += $earned;
            }

            $parts[$part['key']] = ['points' => min($points, $part['max']), 'max' => $part['max']];
        }

        $total = min($this->max(), array_sum(array_column($parts, 'points')));

        return ['total' => $total, 'stage' => $this->stage($total), 'parts' => $parts, 'breakdown' => $breakdown];
    }

    public function stage(int $total): int
    {
        $stage = 1;

        foreach ($this->stages() as $number => $from) {
            if ($total >= $from) {
                $stage = $number;
            }
        }

        return $stage;
    }

    /**
     * @return array<int, int> stage => the score it starts at, ascending
     */
    public function stages(): array
    {
        /** @var array<int|string, int|string> $stages */
        $stages = $this->config()['stages'];
        $result = [];

        foreach ($stages as $stage => $from) {
            $result[(int) $stage] = (int) $from;
        }

        asort($result);

        return $result;
    }

    public function max(): int
    {
        return (int) $this->config()['max'];
    }

    public function version(): string
    {
        return (string) $this->config()['version'];
    }

    public function descriptionMinChars(): int
    {
        return (int) ($this->item('description')['min_chars'] ?? 200);
    }

    /**
     * The owner's "Nächstes Upgrade": what can still be added, with the points it brings and the progress (have/need; the app shows
     * need − have). Sorted by points, most first. `planned_mods` turns planned mods into documented ones.
     *
     * @return list<Upgrade>
     */
    public function nextUpgrades(BuildScoreFacts $facts): array
    {
        $upgrades = [];
        $add = function (string $key, int $have, int $need, int $points) use (&$upgrades): void {
            if ($points > 0 && $need > $have) {
                $upgrades[] = ['key' => $key, 'label_key' => $key, 'points' => $points, 'progress' => ['have' => $have, 'need' => $need]];
            }
        };

        $photos = $this->item('photos');
        $have = min($facts->photos, (int) $photos['limit']);
        $add('photos', $have, (int) $photos['limit'], ((int) $photos['limit'] - $have) * $photos['points']);

        $specs = $this->item('key_specs');
        $have = min($facts->keySpecs, (int) $specs['limit']);
        $add('key_specs', $have, (int) $specs['limit'], ((int) $specs['limit'] - $have) * $specs['points']);

        $chars = $this->descriptionMinChars();
        $add('description', min($facts->descriptionChars, $chars), $chars, $this->item('description')['points']);

        $add('cover_focal', $facts->coverFocal ? 1 : 0, 1, $this->item('cover_focal')['points']);

        // Mods: complete the ones that miss brand, photo or date; else document a planned one; else add one more.
        $mods = $this->item('documented_mods');
        $limit = (int) $mods['limit'];
        $documented = min($facts->documentedMods, $limit);
        $room = $limit - $documented;
        $complete = min($facts->undocumentedMods, $room);

        if ($complete > 0) {
            $add('documented_mods', $documented, $documented + $complete, $complete * $mods['points']);
        }

        $planned = min($facts->plannedMods, $room - $complete);

        if ($planned > 0) {
            $add('planned_mods', 0, $planned, $planned * $mods['points']);
        } elseif ($complete === 0 && $room > 0) {
            $add('documented_mods', $documented, $documented + 1, $mods['points']);
        }

        $registered = $this->item('registered_mods');
        $have = min($facts->registeredMods, (int) $registered['limit']);
        $need = min($facts->existingMods, (int) $registered['limit']);
        $add('registered_mods', $have, $need, ($need - $have) * $registered['points']);

        // One more post or pair at a time: the next entry is what the owner can do now.
        $timeline = $this->item('timeline');

        if ($facts->timeline < (int) $timeline['limit']) {
            $add('timeline', $facts->timeline, $facts->timeline + 1, $timeline['points']);
        }

        $pairs = $this->item('before_after');

        if ($facts->beforeAfter < (int) $pairs['limit']) {
            $add('before_after', $facts->beforeAfter, $facts->beforeAfter + 1, $pairs['points']);
        }

        // Stable: most points first, ties keep the order above.
        $order = array_flip(array_keys($upgrades));
        uksort($upgrades, fn (int $a, int $b): int => [$upgrades[$b]['points'], $order[$a]] <=> [$upgrades[$a]['points'], $order[$b]]);

        return array_values($upgrades);
    }

    /**
     * @return Item
     */
    private function item(string $key): array
    {
        foreach ($this->parts() as $part) {
            foreach ($part['items'] as $item) {
                if ($item['key'] === $key) {
                    return $item;
                }
            }
        }

        return ['key' => $key, 'points' => 0, 'limit' => null, 'max' => 0];
    }

    /**
     * @return array<string, mixed>
     */
    private function config(): array
    {
        if ($this->config === null) {
            /** @var array<string, mixed> $config */
            $config = config()->array('speedclub.build_score');
            $this->config = $config;
        }

        return $this->config;
    }
}
