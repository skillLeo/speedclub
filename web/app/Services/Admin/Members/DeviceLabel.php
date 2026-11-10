<?php

namespace App\Services\Admin\Members;

use App\Models\KnownDevice;
use App\Models\PersonalAccessToken;
use App\Services\Auth\KnownDevices;
use App\Support\Auth\DeviceInfo;
use App\Support\ViewAs;
use Illuminate\Support\Collection;

/**
 * Names for the member's known devices on ADM-10 "Sicherheit & Sitzungen" (m3.2-contract §2: "sign-in dates and device names", DQ-541).
 * A known device is only a fingerprint (KnownDevices, DeviceInfo), so it is named by matching that fingerprint against what the member's
 * own tokens and browser sessions would give: an app sign-in by the token's device name and platform, a browser by a coarse reading
 * of the session's user agent (browser family and operating system, never a version). Nothing raw leaves here: no user agent, IP
 * address or fingerprint. A device nothing matches stays unnamed (the page then numbers it).
 */
final class DeviceLabel
{
    /**
     * @param  Collection<int, PersonalAccessToken>  $tokens  the member's tokens (view-as tokens are staff's and are skipped)
     * @param  iterable<mixed>  $userAgents  the user agents of the member's browser sessions
     * @return array<string, array{kind: 'app'|'browser', name: string|null, platform: string|null, browser: string|null, os: string|null}> by fingerprint
     */
    public static function index(Collection $tokens, iterable $userAgents): array
    {
        $labels = [];

        foreach ($userAgents as $agent) {
            if (! is_string($agent) || $agent === '') {
                continue;
            }
            $parsed = self::parse($agent);
            $labels[KnownDevices::userAgentFingerprint($agent)] = ['kind' => 'browser', 'name' => null, 'platform' => 'web', 'browser' => $parsed['browser'], 'os' => $parsed['os']];
        }

        foreach ($tokens as $token) {
            if (ViewAs::isToken($token)) {
                continue;
            }
            $platform = $token->getAttribute('platform');
            $info = new DeviceInfo($token->deviceName(), $platform, null, $token->deviceId());
            $label = ['kind' => 'app', 'name' => $token->deviceName(), 'platform' => $platform?->value, 'browser' => null, 'os' => null];
            $labels[$info->fingerprint()] = $label;
            // A sign-in before the app sent its install id counted the device by name and platform.
            $labels[(new DeviceInfo($token->deviceName(), $platform))->fingerprint()] ??= $label;
        }

        return $labels;
    }

    /**
     * @param  array<string, array{kind: 'app'|'browser', name: string|null, platform: string|null, browser: string|null, os: string|null}>  $index
     * @return array{kind: 'app'|'browser'|null, name: string|null, platform: string|null, browser: string|null, os: string|null}
     */
    public static function for(KnownDevice $device, array $index): array
    {
        return $index[(string) $device->getAttribute('fingerprint')] ?? ['kind' => null, 'name' => null, 'platform' => null, 'browser' => null, 'os' => null];
    }

    /**
     * Browser family and operating system of a user agent, coarse and without versions. Unknown parts are null.
     *
     * @return array{browser: string|null, os: string|null}
     */
    public static function parse(string $agent): array
    {
        $browser = match (true) {
            str_contains($agent, 'SamsungBrowser/') => 'Samsung Internet',
            str_contains($agent, 'Edg/') || str_contains($agent, 'EdgA/') || str_contains($agent, 'EdgiOS/') => 'Edge',
            str_contains($agent, 'OPR/') => 'Opera',
            str_contains($agent, 'Firefox/') || str_contains($agent, 'FxiOS/') => 'Firefox',
            str_contains($agent, 'Chrome/') || str_contains($agent, 'CriOS/') => 'Chrome',
            str_contains($agent, 'Safari/') && str_contains($agent, 'Version/') => 'Safari',
            default => null,
        };

        $os = match (true) {
            str_contains($agent, 'iPhone') => 'iPhone',
            str_contains($agent, 'iPad') => 'iPad',
            str_contains($agent, 'Android') => 'Android',
            str_contains($agent, 'Windows') => 'Windows',
            str_contains($agent, 'Mac OS X') || str_contains($agent, 'Macintosh') => 'macOS',
            str_contains($agent, 'CrOS') => 'ChromeOS',
            str_contains($agent, 'Linux') => 'Linux',
            default => null,
        };

        return ['browser' => $browser, 'os' => $os];
    }
}
