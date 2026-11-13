<?php

namespace App\Services\Notifications;

use GuzzleHttp\Client;
use Psr\Http\Client\ClientInterface;

/**
 * The PSR-18 client WebPush hands to minishlink/web-push. php-http/discovery's composer plugin is off (ADR-456), so the client is
 * made here instead of discovered: Guzzle (already installed for Laravel's HTTP client) with short timeouts, and no redirects (a
 * push service answers directly; a redirect would send the encrypted payload elsewhere). Tests bind a subclass with Guzzle's
 * MockHandler, so nothing reaches the network.
 */
class WebPushHttp
{
    public function client(): ClientInterface
    {
        return new Client([
            'timeout' => config()->integer('speedclub.web_push.timeout_seconds'),
            'connect_timeout' => config()->integer('speedclub.web_push.connect_timeout_seconds'),
            'allow_redirects' => false,
            'http_errors' => false,
        ]);
    }
}
