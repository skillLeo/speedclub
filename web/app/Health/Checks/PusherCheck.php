<?php

namespace App\Health\Checks;

use Illuminate\Support\Facades\Http;
use Spatie\Health\Checks\Check;
use Spatie\Health\Checks\Result;
use Throwable;

/**
 * Pusher reachability (ADR-009): without the four Pusher values nothing is broadcast and the apps poll, so "not configured" is ok outside
 * production and a warning in it. Configured: one HTTPS request to the cluster's API host with a 3-second limit; any HTTP answer
 * means reachable. Never sends or shows a key.
 */
class PusherCheck extends Check
{
    public function run(): Result
    {
        if (config('broadcasting.default') !== 'pusher') {
            $result = Result::make('not_configured')->meta(['configured' => false]);

            return app()->isProduction() ? $result->warning('Pusher is not configured; the apps poll.') : $result->ok();
        }

        $host = config('broadcasting.connections.pusher.options.host');
        $host = is_string($host) && $host !== '' ? $host : 'api-'.config('broadcasting.connections.pusher.options.cluster', 'eu').'.pusher.com';

        try {
            Http::timeout(3)->connectTimeout(3)->get('https://'.$host.'/');
        } catch (Throwable) {
            return Result::make('unreachable')->meta(['configured' => true, 'reachable' => false])->failed('Pusher did not answer.');
        }

        return Result::make('reachable')->meta(['configured' => true, 'reachable' => true])->ok();
    }
}
