<?php

return [

    /*
    |--------------------------------------------------------------------------
    | Third Party Services
    |--------------------------------------------------------------------------
    |
    | This file is for storing the credentials for third party services such
    | as Mailgun, Postmark, AWS and more. This file provides the de facto
    | location for this type of information, allowing packages to have
    | a conventional file to locate the various service credentials.
    |
    */

    'postmark' => [
        'key' => env('POSTMARK_API_KEY'),
    ],

    'resend' => [
        'key' => env('RESEND_API_KEY'),
    ],

    'ses' => [
        'key' => env('AWS_ACCESS_KEY_ID'),
        'secret' => env('AWS_SECRET_ACCESS_KEY'),
        'region' => env('AWS_DEFAULT_REGION', 'us-east-1'),
    ],

    // M4.6 Sign in with Apple (09 §8.1, ADR-408). client_ids: the bundle ID and the Services ID (web), comma separated; the token's aud must
    // be one of them. The .p8 key (key_id, team_id, private_key_path outside the web root) enables the refresh-token exchange and the
    // revoke at account deletion; without it both are skipped and logged. Owner action OA-15.
    'apple' => [
        'client_ids' => array_values(array_filter(array_map(trim(...), explode(',', (string) env('APPLE_CLIENT_IDS', ''))))),
        'team_id' => env('APPLE_TEAM_ID', env('IOS_TEAM_ID')),
        'key_id' => env('APPLE_KEY_ID'),
        'private_key_path' => env('APPLE_PRIVATE_KEY_PATH'),
        'issuer' => 'https://appleid.apple.com',
        'jwks_url' => 'https://appleid.apple.com/auth/keys',
        'token_url' => 'https://appleid.apple.com/auth/token',
        'revoke_url' => 'https://appleid.apple.com/auth/revoke',
    ],

    // M4.6 Google sign-in by ID token (09 §8.1, ADR-408). client_ids: Web, Android and iOS OAuth client IDs, comma separated (public by
    // design). Owner action OA-26.
    'google' => [
        'client_ids' => array_values(array_filter(array_map(trim(...), explode(',', (string) env('GOOGLE_CLIENT_IDS', ''))))),
        'issuers' => ['accounts.google.com', 'https://accounts.google.com'],
        'jwks_url' => 'https://www.googleapis.com/oauth2/v3/certs',
    ],

    'slack' => [
        'notifications' => [
            'bot_user_oauth_token' => env('SLACK_BOT_USER_OAUTH_TOKEN'),
            'channel' => env('SLACK_BOT_USER_DEFAULT_CHANNEL'),
        ],
    ],

];
