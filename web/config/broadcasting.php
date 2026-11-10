<?php

/*
 * Realtime (05_ARCHITECTURE §11, ADR-009): Pusher Channels in the EU cluster when all four Pusher values exist; otherwise nothing is
 * broadcast and the apps poll. BROADCAST_CONNECTION=log or null wins when set, so a local or staging host can keep the keys and still
 * stay silent. App\Services\Messaging\Realtime is the one place that says whether realtime is on.
 */
$pusherReady = filled(env('PUSHER_APP_KEY')) && filled(env('PUSHER_APP_SECRET')) && filled(env('PUSHER_APP_ID')) && filled(env('PUSHER_APP_CLUSTER'));
$chosen = env('BROADCAST_CONNECTION');

return [

    'default' => in_array($chosen, ['log', 'null'], true) ? $chosen : ($pusherReady ? 'pusher' : 'null'),

    'connections' => [

        'pusher' => [
            'driver' => 'pusher',
            'key' => env('PUSHER_APP_KEY'),
            'secret' => env('PUSHER_APP_SECRET'),
            'app_id' => env('PUSHER_APP_ID'),
            'options' => [
                'cluster' => env('PUSHER_APP_CLUSTER', 'eu'),
                'host' => 'api-'.env('PUSHER_APP_CLUSTER', 'eu').'.pusher.com',
                'port' => 443,
                'scheme' => 'https',
                'encrypted' => true,
                'useTLS' => true,
            ],
            // Events go out after the response; a slow Pusher must not hold a PHP worker for long.
            'client_options' => [
                'timeout' => 3,
                'connect_timeout' => 2,
            ],
        ],

        'log' => [
            'driver' => 'log',
        ],

        'null' => [
            'driver' => 'null',
        ],

    ],

];
