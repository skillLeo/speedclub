<?php

/*
 * A separate PHP process for CacheDeadlockTest: one PHP-FPM worker, so to speak. It boots the app with the database
 * the test passes in the environment (CACHE_STORE=database) and prints one JSON line.
 *
 *   php cache-worker.php add <key>                    Cache::store('database')->add(<key>, 0, 60)
 *   php cache-worker.php hit <key> <count> [<start>]  from the unix time <start> on, <count> × RateLimiter::hit(<key>, 60)
 *
 * "concurrency" counts the concurrency errors (deadlocks) the process ran into, retried ones included.
 */

use Illuminate\Cache\RateLimiter;
use Illuminate\Contracts\Console\Kernel;
use Illuminate\Contracts\Database\ConcurrencyErrorDetector as ConcurrencyErrorDetectorContract;
use Illuminate\Database\ConcurrencyErrorDetector;
use Illuminate\Support\Facades\Cache;
use Illuminate\Support\Facades\DB;

require __DIR__.'/../../../../vendor/autoload.php';

$app = require __DIR__.'/../../../../bootstrap/app.php';
$app->make(Kernel::class)->bootstrap();

$detector = new class implements ConcurrencyErrorDetectorContract
{
    public int $seen = 0;

    public function causedByConcurrencyError(Throwable $e): bool
    {
        $caused = (new ConcurrencyErrorDetector)->causedByConcurrencyError($e);
        $this->seen += $caused ? 1 : 0;

        return $caused;
    }
};
$app->instance(ConcurrencyErrorDetectorContract::class, $detector);

[, $mode, $key] = $argv;
$results = [];
$errors = [];
$limiter = app(RateLimiter::class);

try {
    if ($mode === 'add') {
        $results[] = Cache::store('database')->add($key, 0, 60);
    } else {
        DB::connection()->getPdo();

        while (microtime(true) < (float) ($argv[4] ?? 0)) {
            usleep(1_000);
        }

        for ($i = 0; $i < (int) ($argv[3] ?? 1); $i++) {
            $results[] = $limiter->hit($key, 60);
        }
    }
} catch (Throwable $e) {
    $errors[] = $e::class.': '.substr($e->getMessage(), 0, 160);
}

echo json_encode([
    'results' => $results,
    'errors' => $errors,
    'concurrency' => $detector->seen,
    'limiter' => $limiter::class,
    'store' => Cache::store()->getStore()::class,
]), PHP_EOL;
