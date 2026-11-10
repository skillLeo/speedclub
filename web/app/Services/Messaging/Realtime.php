<?php

namespace App\Services\Messaging;

use App\Enums\ErrorCode;
use App\Exceptions\ApiException;
use Illuminate\Broadcasting\Broadcasters\PusherBroadcaster;
use Illuminate\Contracts\Broadcasting\Factory as BroadcastFactory;
use Illuminate\Contracts\Broadcasting\ShouldBroadcast;
use Illuminate\Contracts\Events\Dispatcher;
use Throwable;

/**
 * Whether realtime is on, and everything that depends on it (05_ARCHITECTURE §11, m2.4-contract §3): GET app-config `realtime`, the
 * /app CSP connect-src, the broadcasts and POST broadcasting/auth. On only when the default broadcaster is pusher with all four values.
 * Events are an accelerator: they carry ids only and go out after the response; a failing Pusher is reported and never fails a send.
 */
class Realtime
{
    public function __construct(
        private readonly BroadcastFactory $broadcast,
        private readonly Dispatcher $events,
    ) {}

    public static function enabled(): bool
    {
        if (config('broadcasting.default') !== 'pusher') {
            return false;
        }

        foreach (['key', 'secret', 'app_id', 'options.cluster'] as $key) {
            $value = config('broadcasting.connections.pusher.'.$key);

            if (! is_string($value) || $value === '') {
                return false;
            }
        }

        return true;
    }

    /**
     * The public values only: never the secret or the app id.
     *
     * @return array{enabled: bool, key: string|null, cluster: string|null}
     */
    public static function publicConfig(): array
    {
        if (! self::enabled()) {
            return ['enabled' => false, 'key' => null, 'cluster' => null];
        }

        return [
            'enabled' => true,
            'key' => config()->string('broadcasting.connections.pusher.key'),
            'cluster' => config()->string('broadcasting.connections.pusher.options.cluster'),
        ];
    }

    /**
     * The hosts pusher-js reaches for the cluster: the socket, its HTTP fallback, and the stats host (global, pusher-js `statsHost`).
     * Empty without realtime, so the CSP stays connect-src 'self'.
     *
     * @return list<string>
     */
    public static function connectHosts(): array
    {
        if (! self::enabled()) {
            return [];
        }

        $cluster = config()->string('broadcasting.connections.pusher.options.cluster');

        if (preg_match('/\A[a-z0-9-]{1,20}\z/', $cluster) !== 1) {
            return [];
        }

        return ["wss://ws-$cluster.pusher.com", "https://sockjs-$cluster.pusher.com", 'https://stats.pusher.com'];
    }

    /**
     * After the response, and never failing the request: the message is stored by then, and polling picks it up anyway.
     */
    public function dispatch(ShouldBroadcast ...$events): void
    {
        if (! self::enabled() || $events === []) {
            return;
        }

        defer(function () use ($events): void {
            foreach ($events as $event) {
                try {
                    $this->events->dispatch($event);
                } catch (Throwable $exception) {
                    report($exception);
                }
            }
        });
    }

    /**
     * The signed answer Pusher expects for a private channel; the caller has checked the member may join it.
     *
     * @return array{auth: string}
     */
    public function sign(string $channel, string $socketId): array
    {
        $broadcaster = $this->broadcast->connection('pusher');

        if (! self::enabled() || ! $broadcaster instanceof PusherBroadcaster) {
            throw new ApiException(ErrorCode::FeatureDisabled, (string) __('errors.realtime_off'));
        }

        /** @var array{auth: string} $answer */
        $answer = json_decode($broadcaster->getPusher()->authorizeChannel($channel, $socketId), true, 4, JSON_THROW_ON_ERROR);

        return ['auth' => $answer['auth']];
    }
}
