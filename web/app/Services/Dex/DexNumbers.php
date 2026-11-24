<?php

namespace App\Services\Dex;

use App\Models\Vehicle;
use Illuminate\Database\Eloquent\Builder;
use Illuminate\Support\Facades\DB;

/**
 * The STREET DEX number of a car ("Nr. 0087", m5.9b contract §1): assigned once, at the first publish, from a counter taken under a row
 * lock (sequence_counters.dex_number), so two publishes at the same moment never share a number. Each database counts on its own:
 * production numbering never mixes with staging. A number is never reused, also not after a delete. Queries go through the connection,
 * not the DB facade's shortcuts, so a caller's transaction (and a test that wraps it) sees one connection.
 *
 * The counter row is created before any locking transaction (prepare(), also called by PublishVehicle and RecordSpot ahead of theirs):
 * an INSERT IGNORE of the existing row inside the transaction takes a shared lock that deadlocks parallel SELECT … FOR UPDATEs
 * (found for the founding numbers in M5.9d, DexNumbersConcurrencyTest). Inside, the row is inserted only when it is missing, and a
 * transaction of our own retries a deadlock.
 */
final class DexNumbers
{
    public const COUNTER = 'dex_number';

    /** Deadlock retries of ensure()'s own transaction (a caller's transaction retries itself). */
    public const ATTEMPTS = 5;

    /**
     * Creates the counter row outside any transaction (a no-op once it exists).
     */
    public function prepare(): void
    {
        DB::connection()->table('sequence_counters')->insertOrIgnore(['key' => self::COUNTER, 'value' => 0]);
    }

    /**
     * The vehicle's number, assigning the next one when it has none. Joins the caller's transaction when there is one.
     */
    public function ensure(Vehicle $vehicle): int
    {
        $db = DB::connection();

        if ($db->transactionLevel() === 0) {
            $this->prepare();
        }

        $number = $db->transaction(function () use ($db, $vehicle): int {
            $current = $db->table('vehicles')->where('id', $vehicle->id)->lockForUpdate()->value('dex_number');

            if (is_numeric($current)) {
                return (int) $current;
            }

            $next = $this->next();
            $db->table('vehicles')->where('id', $vehicle->id)->update(['dex_number' => $next]);

            return $next;
        }, self::ATTEMPTS);

        $vehicle->forceFill(['dex_number' => $number])->syncOriginalAttribute('dex_number');

        return $number;
    }

    /**
     * Numbers for every published vehicle without one, in the order of their first publish (the seeders' backfill; the migration did
     * the same for the vehicles that existed then). Returns how many were assigned. With $deadline (microtime) it stops once that has
     * passed (CR-P5G-12, the nightly step; missing() says whether cars are left). Each batch is read afresh, never by offset: every car
     * numbered leaves the filter, so an offset would skip the next ones.
     */
    public function assignMissing(?float $deadline = null): int
    {
        $count = 0;

        do {
            $vehicles = $this->missingQuery()->select(['id'])->limit(200)->get();

            foreach ($vehicles as $vehicle) {
                /** @var Vehicle $vehicle */
                $this->ensure($vehicle);
                $count++;

                if ($deadline !== null && microtime(true) > $deadline) {
                    return $count;
                }
            }
        } while ($vehicles->count() === 200);

        return $count;
    }

    /** Whether a published vehicle still has no Dex number. */
    public function missing(): bool
    {
        return $this->missingQuery()->exists();
    }

    /**
     * @return Builder<Vehicle>
     */
    private function missingQuery(): Builder
    {
        return Vehicle::withTrashed()
            ->whereNotNull('published_at')
            ->whereNull('deleted_at')
            ->whereNull('dex_number')
            ->orderBy('published_at')
            ->orderBy('id');
    }

    /**
     * Inside a transaction: takes the counter's row lock until the commit. A counter behind the highest number in use (a restored
     * dump, a manual fix) continues after that number instead.
     */
    private function next(): int
    {
        $db = DB::connection();
        $value = $db->table('sequence_counters')->where('key', self::COUNTER)->lockForUpdate()->value('value');

        // Only when missing: an INSERT IGNORE of the existing row would take the shared lock that deadlocks parallel callers.
        if ($value === null) {
            $db->table('sequence_counters')->insertOrIgnore(['key' => self::COUNTER, 'value' => 0]);
            $value = $db->table('sequence_counters')->where('key', self::COUNTER)->lockForUpdate()->value('value');
        }

        $value = (int) $value;
        $next = max($value, (int) $db->table('vehicles')->max('dex_number')) + 1;
        $db->table('sequence_counters')->where('key', self::COUNTER)->update(['value' => $next]);

        return $next;
    }
}
