<?php

use App\Support\Cache\LosslessRateLimiter;
use App\Support\Cache\RetryingDatabaseStore;
use Illuminate\Cache\RateLimiter;
use Illuminate\Cache\RateLimiting\Limit;
use Illuminate\Database\Connection;
use Illuminate\Database\Events\TransactionCommitted;
use Illuminate\Database\QueryException;
use Illuminate\Support\Facades\Cache;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Event;
use Illuminate\Support\Facades\Route;
use Illuminate\Support\Str;
use Symfony\Component\Process\Process;

/*
 * The rate limiter on the database cache store under concurrency (ADR draft of 2026-11-06). Two requests that hit
 * one limiter key together made InnoDB roll back one INSERT IGNORE as a deadlock victim (500), and a request that
 * started a window could overwrite hits counted by the others.
 *
 * Everything here runs on its own connections to the test database, outside the transaction RefreshDatabase opens on
 * the default one, so child processes see the rows and the store's retries are not suppressed by an open transaction.
 */

beforeEach(function () {
    $db = config('database.connections.'.config('database.default'));

    config([
        'database.connections.cache_probe' => $db,
        'database.connections.cache_neighbour' => $db,
        'cache.stores.probe' => ['driver' => 'database-retrying', 'connection' => 'cache_probe', 'table' => 'cache', 'attempts' => 3],
        'cache.stores.neighbour' => ['driver' => 'database-retrying', 'connection' => 'cache_neighbour', 'table' => 'cache'],
    ]);

    $this->key = 'deadlock-test-'.Str::lower(Str::random(10));
    $this->probe = DB::connection('cache_probe');
    $this->raw = fn (string $key): string => config()->string('cache.prefix').$key;
    $this->limiter = fn (): RateLimiter => new LosslessRateLimiter(Cache::store('probe'));
});

afterEach(function () {
    // A fresh connection, without the deadlocks a test injected. ThrottleRequests names a named limiter's key md5(name.key).
    DB::purge('cache_probe');
    DB::purge('cache_neighbour');
    $throttled = ($this->raw)(md5($this->key.'deadlock-test'));
    DB::connection('cache_probe')->table('cache')
        ->where('key', 'like', '%deadlock-test-%')
        ->orWhereIn('key', [$throttled, $throttled.':timer'])
        ->delete();
    DB::purge('cache_probe');
});

/**
 * Throws a deadlock like InnoDB's for the first $times statements that start with $sqlStart, and counts every
 * statement that does.
 */
function deadlockOn(Connection $connection, string $sqlStart, int $times): stdClass
{
    $seen = (object) ['runs' => 0];

    $connection->beforeExecuting(function (string $sql, array $bindings) use ($connection, $sqlStart, $times, $seen): void {
        if (! str_starts_with($sql, $sqlStart)) {
            return;
        }

        if (++$seen->runs <= $times) {
            throw new QueryException($connection->getName() ?? 'cache_probe', $sql, $bindings, new PDOException(
                'SQLSTATE[40001]: Serialization failure: 1213 Deadlock found when trying to get lock; try restarting transaction',
            ));
        }
    });

    return $seen;
}

/**
 * A child PHP process running tests/Feature/Platform/Fixtures/cache-worker.php against the test database.
 *
 * @param  list<string>  $arguments
 */
function cacheWorker(array $arguments): Process
{
    $db = config('database.connections.'.config('database.default'));

    $process = new Process([PHP_BINARY, __DIR__.'/Fixtures/cache-worker.php', ...$arguments], base_path(), [
        'APP_ENV' => 'testing',
        'CACHE_STORE' => 'database',
        'CACHE_PREFIX' => config()->string('cache.prefix'),
        'DB_CONNECTION' => config('database.default'),
        'DB_URL' => '',
        'DB_HOST' => (string) $db['host'],
        'DB_PORT' => (string) $db['port'],
        'DB_DATABASE' => (string) $db['database'],
        'DB_USERNAME' => (string) $db['username'],
        'DB_PASSWORD' => (string) $db['password'],
    ], timeout: 60);
    $process->start();

    return $process;
}

/**
 * @return array{results: list<int|bool>, errors: list<string>, concurrency: int, limiter: string, store: string}
 */
function workerOutput(Process $process): array
{
    $process->wait();
    expect($process->getExitCode())->toBe(0, $process->getErrorOutput());

    return json_decode(trim($process->getOutput()), true, flags: JSON_THROW_ON_ERROR);
}

it('serves the database store and the rate limiter through the retrying store and the lossless limiter', function () {
    expect(Cache::store('database')->getStore())->toBeInstanceOf(RetryingDatabaseStore::class)
        ->and(app(RateLimiter::class))->toBeInstanceOf(LosslessRateLimiter::class)
        ->and(app(RateLimiter::class)->limiter('public-read'))->not->toBeNull()
        ->and(config('cache.limiter'))->toBeNull();
});

it('survives the deadlock of two processes inserting one key, and adds it once', function () {
    // The InnoDB case from the log: a third transaction holds the row, two INSERT IGNOREs wait for an S lock on it,
    // the row goes away and both, granted S, wait for each other's X. InnoDB rolls one of them back (1213).
    $this->probe->beginTransaction();
    $this->probe->table('cache')->insert(['key' => ($this->raw)($this->key), 'value' => 'i:5;', 'expiration' => 1]);

    $workers = [cacheWorker(['add', $this->key]), cacheWorker(['add', $this->key])];

    $waiting = 0;
    for ($i = 0; $i < 150 && $waiting < 2; $i++) {
        usleep(100_000);
        $waiting = (int) DB::connection('cache_probe')->scalar(
            "select count(*) from information_schema.innodb_trx where trx_state = 'LOCK WAIT' and trx_query like ?",
            ['%'.($this->raw)($this->key).'%'],
        );
    }

    $this->probe->rollBack();
    $outputs = array_map(workerOutput(...), $workers);

    expect($waiting)->toBe(2)
        ->and(array_merge(...array_column($outputs, 'errors')))->toBe([])
        ->and(array_merge(...array_column($outputs, 'results')))->toEqualCanonicalizing([true, false])
        ->and(array_sum(array_column($outputs, 'concurrency')))->toBeGreaterThanOrEqual(1)
        ->and($this->probe->table('cache')->where('key', ($this->raw)($this->key))->value('value'))->toBe('i:0;');
});

it('counts every hit of processes that start one window together', function () {
    $start = (string) (microtime(true) + 3);
    $workers = array_map(fn (): Process => cacheWorker(['hit', $this->key, '10', $start]), range(1, 4));
    $outputs = array_map(workerOutput(...), $workers);

    expect(array_merge(...array_column($outputs, 'errors')))->toBe([])
        ->and(array_unique(array_column($outputs, 'limiter')))->toBe([LosslessRateLimiter::class])
        ->and(array_unique(array_column($outputs, 'store')))->toBe([RetryingDatabaseStore::class])
        ->and(($this->limiter)()->attempts($this->key))->toBe(40);
});

it('keeps the hit another request counts while this one opens the window', function () {
    // Request A added the counter row (0) and has not counted yet; this request finds the row, counts first (1), and
    // A counts right after (2). The framework's limiter then put() 1 over it.
    $neighbour = Cache::store('neighbour');
    $neighbour->add($this->key.':timer', now()->getTimestamp() + 60, 60);
    $neighbour->add($this->key, 0, 60);

    $counted = false;
    Event::listen(TransactionCommitted::class, function (TransactionCommitted $event) use (&$counted, $neighbour): void {
        if ($event->connectionName === 'cache_probe' && ! $counted) {
            $counted = true;
            $neighbour->increment($this->key);
        }
    });

    expect(($this->limiter)()->hit($this->key, 60))->toBe(1)
        ->and($counted)->toBeTrue()
        ->and(($this->limiter)()->attempts($this->key))->toBe(2);
});

it('takes two hits on an expired key without throwing and starts a new window', function () {
    $this->probe->table('cache')->insert([
        ['key' => ($this->raw)($this->key), 'value' => 'i:15;', 'expiration' => now()->getTimestamp() - 5],
        ['key' => ($this->raw)($this->key.':timer'), 'value' => serialize(now()->getTimestamp() - 5), 'expiration' => now()->getTimestamp() - 5],
    ]);
    // The expired row's delete is the statement that runs into the inserting neighbour.
    $deletes = deadlockOn($this->probe, 'delete from', 1);
    $limiter = ($this->limiter)();

    expect($limiter->tooManyAttempts($this->key, 15))->toBeFalse()
        ->and($limiter->hit($this->key, 60))->toBe(1)
        ->and($limiter->hit($this->key, 60))->toBe(2)
        ->and($limiter->attempts($this->key))->toBe(2)
        ->and($limiter->availableIn($this->key))->toBeGreaterThan(55)
        ->and($deletes->runs)->toBeGreaterThanOrEqual(2);
});

it('retries a deadlocked insert and a deadlocked increment exactly once each, so no hit is lost or doubled', function () {
    $inserts = deadlockOn($this->probe, 'insert ignore into', 1);
    $updates = deadlockOn($this->probe, 'update', 1);
    $limiter = ($this->limiter)();

    expect($limiter->hit($this->key, 60))->toBe(1)
        ->and($limiter->hit($this->key, 60))->toBe(2)
        ->and($limiter->attempts($this->key))->toBe(2)
        ->and($inserts->runs)->toBe(3)
        ->and($updates->runs)->toBe(3);
});

it('gives up after the configured attempts and throws instead of letting the request through', function () {
    $inserts = deadlockOn($this->probe, 'insert ignore into', PHP_INT_MAX);

    expect(fn () => ($this->limiter)()->hit($this->key, 60))
        ->toThrow(QueryException::class, 'Deadlock found');
    expect($inserts->runs)->toBe(3);
});

it('leaves a deadlock inside a caller\'s transaction to that transaction', function () {
    // MySQL rolled the whole transaction back: repeating one statement in it would be wrong.
    $inserts = deadlockOn($this->probe, 'insert ignore into', 2);

    expect(fn () => $this->probe->transaction(fn () => Cache::store('probe')->add($this->key, 0, 60)))
        ->toThrow(QueryException::class, 'Deadlock found');
    expect($inserts->runs)->toBe(1)
        // A transaction that was given attempts runs again as a whole.
        ->and($this->probe->transaction(fn () => Cache::store('probe')->add($this->key, 0, 60), attempts: 2))->toBeTrue()
        ->and($inserts->runs)->toBe(3)
        ->and($this->probe->transactionLevel())->toBe(0);
});

it('does not retry errors that are not concurrency errors', function () {
    $runs = 0;
    $this->probe->beforeExecuting(function (string $sql, array $bindings) use (&$runs): void {
        if (str_starts_with($sql, 'insert ignore into')) {
            $runs++;

            throw new QueryException('cache_probe', $sql, $bindings, new PDOException("SQLSTATE[42S02]: Base table or view not found: 1146 Table 'cache' doesn't exist"));
        }
    });

    expect(fn () => Cache::store('probe')->add($this->key, 0, 60))->toThrow(QueryException::class, 'Base table');
    expect($runs)->toBe(1);
});

it('answers a throttled request instead of 500 when the limiter\'s insert is a deadlock victim', function () {
    $limiter = ($this->limiter)();
    // Named after the test key, so afterEach finds its rows.
    $limiter->for($this->key, fn () => Limit::perMinute(5)->by('deadlock-test'));
    app()->instance(RateLimiter::class, $limiter);
    $inserts = deadlockOn($this->probe, 'insert ignore into', 2);
    Route::middleware(['api', 'throttle:'.$this->key])->get('api/v1/test/deadlock-throttled', fn () => response()->json(['ok' => true]));

    $this->getJson('api/v1/test/deadlock-throttled')
        ->assertOk()
        ->assertHeader('X-RateLimit-Remaining', '4');
    expect($inserts->runs)->toBe(4);
});
