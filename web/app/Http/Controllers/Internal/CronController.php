<?php

namespace App\Http\Controllers\Internal;

use App\Http\Controllers\Controller;
use App\Support\ClientAddress;
use Illuminate\Http\Request;
use Illuminate\Http\Response;
use Illuminate\Support\Facades\Artisan;
use Illuminate\Support\Facades\Cache;
use Illuminate\Support\Facades\RateLimiter;
use Throwable;

/**
 * GET /internal/cron/{token} (M5.11, ADR-503): the cronjob of a host that calls a URL instead of running a command (ALL-INKL).
 * It answers 204 at once and runs speedclub:schedule-inline after the response, the same command the CLI cron uses on a host
 * without proc_open, so the due tasks, overlap locks and the Spatie heartbeat that speedclub:doctor reads are the same.
 *
 * - No token configured (or one under the minimum length): 404, as if the route did not exist.
 * - A wrong token: 404 as well, compared in constant time; the address is counted for every request, valid or not.
 * - Two triggers at once: the second finds the lock taken and does nothing (still 204).
 * The token is part of the URL, so it appears in the host's access log: treat that log as secret and rotate the token if it leaks.
 */
class CronController extends Controller
{
    public const LOCK = 'speedclub:cron-url';

    public function __invoke(Request $request, string $token): Response
    {
        $expected = config()->string('speedclub.scheduler.cron_token');

        if (strlen($expected) < config()->integer('speedclub.scheduler.cron_min_token_length')) {
            abort(404);
        }

        $key = 'cron-url|'.ClientAddress::key($request);
        if (RateLimiter::tooManyAttempts($key, config()->integer('speedclub.scheduler.cron_max_per_minute'))) {
            return response('', 429, ['Retry-After' => (string) max(1, RateLimiter::availableIn($key)), 'Cache-Control' => 'no-store']);
        }
        RateLimiter::hit($key, 60);

        if (! hash_equals($expected, $token)) {
            abort(404);
        }

        ignore_user_abort(true);
        defer(fn () => $this->run())->always();

        return response('', 204, ['Cache-Control' => 'no-store', 'X-Robots-Tag' => 'noindex']);
    }

    private function run(): void
    {
        $lock = Cache::lock(self::LOCK, config()->integer('speedclub.scheduler.cron_lock_seconds'));
        if (! $lock->get()) {
            return;
        }

        try {
            Artisan::call('speedclub:schedule-inline');
        } catch (Throwable $exception) {
            report($exception);
        } finally {
            $lock->release();
        }
    }
}
