<?php

namespace App\Support\Cache;

use Closure;
use Illuminate\Cache\DatabaseStore;
use Illuminate\Cache\Repository;
use Illuminate\Contracts\Foundation\Application;
use Illuminate\Database\DatabaseManager;
use Illuminate\Database\DetectsConcurrencyErrors;
use Illuminate\Database\QueryException;

/**
 * The framework's database cache store, with every statement that takes row locks retried when InnoDB picks it as a
 * deadlock victim (ADR draft "rate limiter deadlocks", 2026-11-06).
 *
 * Why: two INSERT IGNOREs of the same key that both find a delete-marked row (an expired counter that get() just
 * removed, or a row another transaction is inserting and then rolls back) are both granted an S record lock and both
 * wait for X: InnoDB rolls one back with 1213, and RateLimiter::hit() threw that as a 500. A deadlock victim's
 * statement had no effect, so running it again is exact: no hit is lost and none is counted twice (increment's
 * SELECT … FOR UPDATE and UPDATE run in one transaction that was rolled back as a whole).
 *
 * Retries are bounded; a statement that still fails throws, so a request is never let through unthrottled. Inside a
 * caller's transaction nothing is retried here, as MySQL rolled back that whole transaction: the error goes to the
 * caller's DB::transaction(), which retries the unit when it was given attempts.
 */
class RetryingDatabaseStore extends DatabaseStore
{
    use DetectsConcurrencyErrors;

    /** How often a statement runs at most, the first run included. */
    public const DEFAULT_ATTEMPTS = 3;

    private int $attempts = self::DEFAULT_ATTEMPTS;

    /** Nested calls (add() reads through many()) run inside the outermost retry instead of multiplying attempts. */
    private int $depth = 0;

    /**
     * The "database-retrying" cache driver: the framework's createDatabaseDriver() with this store.
     *
     * @param  array<string, mixed>  $config
     */
    public static function driver(Application $app, array $config): Repository
    {
        /** @var DatabaseManager $db */
        $db = $app->make('db');
        $connection = is_string($config['connection'] ?? null) ? $config['connection'] : null;
        $lockConnection = is_string($config['lock_connection'] ?? null) ? $config['lock_connection'] : $connection;
        $prefix = $config['prefix'] ?? config('cache.prefix');
        $lockTable = $config['lock_table'] ?? null;

        $store = new self(
            $db->connection($connection),
            is_string($config['table'] ?? null) ? $config['table'] : 'cache',
            is_string($prefix) ? $prefix : '',
            is_string($lockTable) ? $lockTable : 'cache_locks',
            is_array($config['lock_lottery'] ?? null) ? $config['lock_lottery'] : [2, 100],
            is_int($config['lock_timeout'] ?? null) ? $config['lock_timeout'] : 86400,
            config('cache.serializable_classes'),
        );

        $store->setLockConnection($db->connection($lockConnection));
        $store->setAttempts(is_int($config['attempts'] ?? null) ? $config['attempts'] : self::DEFAULT_ATTEMPTS);

        return $app->make('cache')->repository($store, $config);
    }

    public function setAttempts(int $attempts): static
    {
        $this->attempts = max(1, $attempts);

        return $this;
    }

    /**
     * Reads, and deletes the expired rows among them.
     *
     * @param  array<int, string>  $keys
     * @return array<string, mixed>
     */
    public function many(array $keys)
    {
        return $this->retrying(fn (): array => parent::many($keys));
    }

    /**
     * @param  array<string, mixed>  $values
     * @param  int  $seconds
     */
    public function putMany(array $values, $seconds)
    {
        return $this->retrying(fn (): bool => parent::putMany($values, $seconds));
    }

    /**
     * @param  string  $key
     * @param  mixed  $value
     * @param  int  $seconds
     */
    public function add($key, $value, $seconds)
    {
        return $this->retrying(fn (): bool => parent::add($key, $value, $seconds));
    }

    /**
     * @param  string  $key
     * @param  int  $seconds
     */
    public function touch($key, $seconds)
    {
        return $this->retrying(fn (): bool => parent::touch($key, $seconds));
    }

    /**
     * @param  string  $key
     * @param  int|float  $value
     * @param  Closure(int, int|float): (int|float)  $callback
     * @return int|false
     */
    protected function incrementOrDecrement($key, $value, Closure $callback)
    {
        return $this->retrying(fn (): int|false => parent::incrementOrDecrement($key, $value, $callback));
    }

    /**
     * @param  array<int, string>  $keys
     */
    protected function forgetMany(array $keys)
    {
        return $this->retrying(fn (): bool => parent::forgetMany($keys));
    }

    /**
     * @param  array<int, string>  $keys
     */
    protected function forgetManyIfExpired(array $keys, bool $prefixed = false)
    {
        return $this->retrying(fn (): bool => parent::forgetManyIfExpired($keys, $prefixed));
    }

    /**
     * @template TResult
     *
     * @param  Closure(): TResult  $statement
     * @return TResult
     */
    private function retrying(Closure $statement): mixed
    {
        if ($this->depth > 0 || $this->connection->transactionLevel() > 0) {
            return $statement();
        }

        $this->depth++;

        try {
            for ($attempt = 1; ; $attempt++) {
                try {
                    return $statement();
                } catch (QueryException $e) {
                    if ($attempt >= $this->attempts || ! $this->causedByConcurrencyError($e)) {
                        throw $e;
                    }

                    // A few milliseconds apart, so the two victims of one conflict do not meet again.
                    usleep(random_int(2_000, 10_000) * $attempt);
                }
            }
        } finally {
            $this->depth--;
        }
    }
}
