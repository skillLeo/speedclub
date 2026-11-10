<?php

namespace App\Services\Home;

/**
 * Builds one page of Für dich from the ranked builds and the update rows (02_PRODUCT_SPEC §3.8, M2.2). The rules, in this order:
 *
 * 1. Builds come in rank order (rank_score, then the last change, then vehicle id, all descending), each once.
 * 2. Diversity: at most max_run (2) items of one owner in a row, update rows included, across page boundaries. When the next build would
 *    make a third, the first build of another owner in rank order goes first, and the held-back build follows as soon as it may. When
 *    max_deferred (10) builds are held back, or no other owner is left, the rule gives way and the next build in rank order follows.
 * 3. After every update_every (3) vehicle cards, one update row: the newest visible update not shown yet, one per build (its latest).
 *    An update of one of those cards, or of the card that would follow the row, is skipped for good, as the card itself shows its latest
 *    change; so an update row never sits next to a card of its own build (M2.3 follow-up). When the next update would break rule 2, the
 *    row waits until after the next card.
 * 4. What the page above the stream shows (featured, the first Neue Builds, the Build-Updates module) is left out of the stream.
 *
 * Deterministic: the same state and rows give the same items, whatever the page size, so pages read one after another are the stream
 * read at once (Pest proves it).
 */
final class StreamAssembler
{
    /** Builds read at a time when the held-back ones do not do. */
    private const BATCH = 4;

    /** Update rows read at a time, and skipped at most per slot. */
    private const UPDATE_BATCH = 5;

    private const UPDATE_SCANS = 10;

    public function __construct(
        private readonly int $maxRun = 2,
        private readonly int $updateEvery = 3,
        private readonly int $maxDeferred = 10,
    ) {}

    public static function fromConfig(): self
    {
        return new self(
            config()->integer('speedclub.home.ranking.max_run'),
            config()->integer('speedclub.home.ranking.update_every'),
            config()->integer('speedclub.home.ranking.max_deferred'),
        );
    }

    /**
     * @return array{items: list<StreamVehicle|StreamUpdate>, state: StreamState|null} state null: the stream ends here
     */
    public function page(StreamSource $source, StreamState $state, int $perPage): array
    {
        $state = clone $state;
        $pool = $source->vehiclesByIds($state->deferred);
        $exhausted = false;
        $updates = [];
        $updatesDone = false;
        $items = [];

        while (count($items) < $perPage) {
            if ($state->sinceUpdate >= $this->updateEvery && ! $updatesDone) {
                $update = $this->nextUpdate($source, $state, $updates, $updatesDone, $pool, $exhausted);

                if ($update !== null) {
                    $items[] = $update;
                    $state->sinceUpdate = 0;
                    $this->advance($state, $update->ownerId);

                    continue;
                }
            }

            $pick = $this->firstAllowed($pool, $state);

            if ($pick === null && ! $exhausted && count($pool) < $this->maxDeferred) {
                $this->fetch($source, $state, $pool, $exhausted);

                continue;
            }

            if ($pick === null) {
                if ($pool === []) {
                    break;
                }

                $pick = 0;
            }

            $vehicle = array_splice($pool, $pick, 1)[0];
            $items[] = $vehicle;
            $this->advance($state, $vehicle->ownerId);
            $state->recent = array_slice([...$state->recent, $vehicle->id], -$this->updateEvery);
            $state->sinceUpdate++;
        }

        $state->deferred = array_map(fn (StreamVehicle $vehicle): string => $vehicle->id, $pool);
        $more = $pool !== [] || (! $exhausted && $source->vehiclesAfter($state->position, $state->excludedVehicles, 1) !== []);

        return ['items' => $items, 'state' => $more ? $state : null];
    }

    /**
     * @param  list<StreamVehicle>  $pool
     */
    private function fetch(StreamSource $source, StreamState $state, array &$pool, bool &$exhausted): void
    {
        $fetched = $source->vehiclesAfter($state->position, $state->excludedVehicles, self::BATCH);

        if ($fetched === []) {
            $exhausted = true;

            return;
        }

        $pool = [...$pool, ...$fetched];
        $last = end($fetched);
        $state->position = [$last->score, $last->changedAt, $last->id];
    }

    /**
     * The card that would follow an item of $afterOwner: the same choice the page loop makes next, reading more builds when it would.
     * Deterministic, as the pool it fills is the pool the loop and the next page read on.
     *
     * @param  list<StreamVehicle>  $pool
     */
    private function nextCard(StreamSource $source, StreamState $state, array &$pool, bool &$exhausted, string $afterOwner): ?StreamVehicle
    {
        $after = clone $state;
        $this->advance($after, $afterOwner);

        while (true) {
            $pick = $this->firstAllowed($pool, $after);

            if ($pick === null && ! $exhausted && count($pool) < $this->maxDeferred) {
                $this->fetch($source, $state, $pool, $exhausted);

                continue;
            }

            return $pool[$pick ?? 0] ?? null;
        }
    }

    /**
     * @param  list<StreamUpdate>  $buffer  read ahead within this page
     * @param  list<StreamVehicle>  $pool
     */
    private function nextUpdate(StreamSource $source, StreamState $state, array &$buffer, bool &$done, array &$pool, bool &$exhausted): ?StreamUpdate
    {
        for ($scan = 0; $scan < self::UPDATE_SCANS; $scan++) {
            if ($buffer === []) {
                $buffer = $source->updatesAfter($state->updatePosition, $state->excludedUpdates, self::UPDATE_BATCH);

                if ($buffer === []) {
                    $done = true;

                    return null;
                }
            }

            $update = $buffer[0];

            if (in_array($update->vehicleId, $state->recent, true)) {
                array_shift($buffer);
                $state->updatePosition = [$update->at, $update->id];

                continue;
            }

            if (! $this->allows($state, $update->ownerId)) {
                return null;
            }

            if ($this->nextCard($source, $state, $pool, $exhausted, $update->ownerId)?->id === $update->vehicleId) {
                array_shift($buffer);
                $state->updatePosition = [$update->at, $update->id];

                continue;
            }

            array_shift($buffer);
            $state->updatePosition = [$update->at, $update->id];

            return $update;
        }

        return null;
    }

    /**
     * @param  list<StreamVehicle>  $pool
     */
    private function firstAllowed(array $pool, StreamState $state): ?int
    {
        foreach ($pool as $index => $vehicle) {
            if ($this->allows($state, $vehicle->ownerId)) {
                return $index;
            }
        }

        return null;
    }

    private function allows(StreamState $state, string $ownerId): bool
    {
        return $ownerId !== $state->lastOwner || $state->run < $this->maxRun;
    }

    private function advance(StreamState $state, string $ownerId): void
    {
        if ($ownerId === $state->lastOwner) {
            $state->run++;
        } else {
            $state->lastOwner = $ownerId;
            $state->run = 1;
        }
    }
}
