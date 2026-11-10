<?php

namespace App\Services\System;

use App\Models\Staff;

/**
 * ADM-50 integrations, status only (m3.6 §1, 06 §3: never show secrets): for each, whether it is configured and, where harmless, the
 * driver or provider name; never a key, host, user, token or address. The test buttons' availability, with the reason when one is off.
 */
final class Integrations
{
    /**
     * @return list<array{key: string, configured: bool, driver: string|null, test: array{available: bool, reason: string|null}}>
     */
    public function status(Staff $staff): array
    {
        $mailer = (string) config('mail.default');
        $aiProvider = config('speedclub.services.ai_provider');
        $aiProvider = is_string($aiProvider) && $aiProvider !== '' ? $aiProvider : null;

        return [
            [
                'key' => 'mail',
                'configured' => ! in_array($mailer, ['log', 'array'], true),
                'driver' => $mailer,
                'test' => ['available' => true, 'reason' => null],
            ],
            [
                'key' => 'pusher',
                'configured' => self::pusherConfigured(),
                'driver' => null,
                'test' => self::pusherConfigured() ? ['available' => true, 'reason' => null] : ['available' => false, 'reason' => 'not_configured'],
            ],
            [
                'key' => 'push',
                'configured' => self::filled('speedclub.services.expo_access_token'),
                'driver' => 'expo',
                // Staff accounts register no device tokens (push_tokens belong to members): the test push has no target.
                'test' => ['available' => false, 'reason' => 'no_device'],
            ],
            [
                'key' => 'ai',
                'configured' => $aiProvider !== null && self::filled("ai.providers.$aiProvider.key"),
                'driver' => $aiProvider,
                // Without a provider the test runs against the SDK's fake (RunTestAiCall).
                'test' => ['available' => true, 'reason' => null],
            ],
            [
                'key' => 'turnstile',
                'configured' => self::filled('speedclub.services.turnstile_site_key') && self::filled('speedclub.services.turnstile_secret'),
                'driver' => null,
                'test' => ['available' => false, 'reason' => 'no_test'],
            ],
            [
                'key' => 'sentry',
                'configured' => self::filled('speedclub.services.sentry_dsn'),
                'driver' => null,
                'test' => ['available' => false, 'reason' => 'no_test'],
            ],
        ];
    }

    public static function pusherConfigured(): bool
    {
        return config('broadcasting.default') === 'pusher'
            && self::filled('broadcasting.connections.pusher.key')
            && self::filled('broadcasting.connections.pusher.secret')
            && self::filled('broadcasting.connections.pusher.app_id');
    }

    public static function aiConfigured(): bool
    {
        $provider = config('speedclub.services.ai_provider');

        return is_string($provider) && $provider !== '' && self::filled("ai.providers.$provider.key");
    }

    private static function filled(string $key): bool
    {
        $value = config($key);

        return is_string($value) && trim($value) !== '';
    }
}
