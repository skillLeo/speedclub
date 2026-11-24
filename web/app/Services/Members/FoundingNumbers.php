<?php

namespace App\Services\Members;

use App\Models\User;
use Illuminate\Support\Facades\DB;

/**
 * Founding Member #0001–#1000 (m5.9d contract §4, 10 §16.4): the next number from sequence_counters.founding_number, taken under the
 * counter's row lock in the caller's transaction (or its own), so parallel activations never share a number and a rolled-back
 * activation leaves no gap. Only where APP_ENV is in `founding.environments` (production), never for sample or editorial accounts or
 * the demo/test address domains, never re-used (the counter only grows, also past a deleted account), and nothing after `founding.max`.
 * Queries go through the connection, so a caller's transaction holds the lock until its commit.
 */
final class FoundingNumbers
{
    public const COUNTER = 'founding_number';

    /** Deadlocks under many parallel activations are retried (only where this runs its own transaction). */
    public const ATTEMPTS = 5;

    public static function eligible(User $user): bool
    {
        if (! app()->environment(config()->array('speedclub.founding.environments')) || $user->trashed()) {
            return false;
        }

        if ($user->getAttribute('is_sample') === true || $user->getAttribute('is_editorial') === true) {
            return false;
        }

        $domain = mb_strtolower((string) substr(strrchr($user->email, '@') ?: '', 1));

        return ! in_array($domain, array_map(mb_strtolower(...), config()->array('speedclub.founding.excluded_email_domains')), true);
    }

    /**
     * Creates the counter row outside any transaction. Inserting it inside a locking transaction, while other activations wait for the
     * same missing key, deadlocks InnoDB (FoundingConcurrencyTest found it); callers with a transaction of their own call this first.
     */
    public function prepare(): void
    {
        DB::connection()->table('sequence_counters')->insertOrIgnore(['key' => self::COUNTER, 'value' => 0]);
    }

    /**
     * The member's number, assigning the next one when eligible and none is set; null when not eligible or all numbers are taken.
     */
    public function assign(User $user): ?int
    {
        if (! self::eligible($user)) {
            return null;
        }

        $db = DB::connection();

        if ($db->transactionLevel() === 0) {
            $this->prepare();
        }

        $number = $db->transaction(function () use ($db, $user): ?int {
            $current = $db->table('users')->where('id', $user->id)->lockForUpdate()->value('founding_number');

            if (is_numeric($current)) {
                return (int) $current;
            }

            // INSERT IGNORE on an existing row takes a shared lock that deadlocks the FOR UPDATE of parallel activations: only when missing.
            $value = $db->table('sequence_counters')->where('key', self::COUNTER)->lockForUpdate()->value('value');

            if ($value === null) {
                $db->table('sequence_counters')->insertOrIgnore(['key' => self::COUNTER, 'value' => 0]);
                $value = $db->table('sequence_counters')->where('key', self::COUNTER)->lockForUpdate()->value('value');
            }

            $value = (int) $value;
            // A counter behind the highest number in use (a restored dump, a manual fix) continues after that number.
            $next = max($value, (int) $db->table('users')->max('founding_number')) + 1;

            if ($next > config()->integer('speedclub.founding.max')) {
                return null;
            }

            $db->table('sequence_counters')->where('key', self::COUNTER)->update(['value' => $next]);
            $db->table('users')->where('id', $user->id)->update(['founding_number' => $next]);

            return $next;
        }, self::ATTEMPTS);

        if ($number !== null) {
            $user->forceFill(['founding_number' => $number])->syncOriginalAttribute('founding_number');
        }

        return $number;
    }
}
