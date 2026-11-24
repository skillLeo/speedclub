<?php

namespace App\Services\Config\Schemas;

use App\Enums\ConfigKey;
use App\Enums\ConfigVersionStatus;
use App\Models\ConfigVersion;
use App\Services\Wrapped\Season;
use Carbon\CarbonImmutable;
use Illuminate\Support\Facades\Validator;

/**
 * `remote_config` (ADM-37): {min_version, latest_version: {ios, android} as x.y.z with min ≤ latest, force_update_message: {de, en}|null,
 * maintenance: {enabled, message: {de, en}|null}, wrapped?: {releases: {season_key: ISO 8601}}} (M5.9e, only when given). Turning maintenance on is four-eyes (`maintenance.enable`, 06 §2); off is immediate.
 * Members have no bypass; a staff member's signed preview token is the bypass (App\Services\Config\PreviewTokens).
 */
final class RemoteConfigSchema extends Schema
{
    private const VERSION = 'regex:/\A(0|[1-9]\d{0,3})\.(0|[1-9]\d{0,3})\.(0|[1-9]\d{0,3})\z/';

    public function key(): ConfigKey
    {
        return ConfigKey::RemoteConfig;
    }

    public function normalize(array $payload): array
    {
        $rules = [
            'maintenance' => ['required', 'array'],
            'maintenance.enabled' => ['required', 'boolean'],
            ...$this->localizedRules('maintenance.message', false, 300),
            ...$this->localizedRules('force_update_message', false, 300),
        ];

        foreach (['min_version', 'latest_version'] as $field) {
            $rules[$field] = ['required', 'array'];
            $rules["$field.ios"] = ['required', 'string', self::VERSION];
            $rules["$field.android"] = ['required', 'string', self::VERSION];
        }

        $data = Validator::make($payload, $rules)->validate();
        $errors = [];

        foreach (['ios', 'android'] as $platform) {
            if (version_compare((string) $data['min_version'][$platform], (string) $data['latest_version'][$platform], '>')) {
                $errors["min_version.$platform"] = (string) __('content.remote.min_above_latest');
            }
        }

        $enabled = (bool) $data['maintenance']['enabled'];
        $message = $this->localized($data['maintenance']['message'] ?? null);

        if ($enabled && $message === null) {
            $errors['maintenance.message.de'] = (string) __('content.remote.maintenance_message');
        }

        $releases = $this->wrappedReleases($payload, $errors);

        if ($errors !== []) {
            $this->refuse($errors);
        }

        return [
            'min_version' => ['ios' => (string) $data['min_version']['ios'], 'android' => (string) $data['min_version']['android']],
            'latest_version' => ['ios' => (string) $data['latest_version']['ios'], 'android' => (string) $data['latest_version']['android']],
            'force_update_message' => $this->localized($data['force_update_message'] ?? null),
            'maintenance' => ['enabled' => $enabled, 'message' => $message],
            // M5.9e: kept only when the draft carries it, so a payload without it stays exactly as before.
            ...($releases === null ? [] : ['wrapped' => ['releases' => $releases]]),
        ];
    }

    /**
     * M5.9e Season Wrapped (m5.9e contract §1): `wrapped.releases` = {"2027-saison": "2027-11-01T10:00:00+01:00", …}, a season key
     * (`YYYY-saison` or `YYYY-jahr`) and an ISO 8601 date with its offset each; normalised to ISO 8601. Null when the draft has none.
     *
     * CR-P5G-06: a release that is new or moved (not the published value of its season) must lie at least one day ahead, so the nightly
     * passes reach every member before it, and after the season's last moment (Season::toUtc), so no month is missing. A release that
     * stays as published is never refused, also once it is in the past.
     *
     * @param  array<array-key, mixed>  $payload
     * @param  array<string, string>  $errors
     * @return array<string, string>|null
     */
    private function wrappedReleases(array $payload, array &$errors): ?array
    {
        if (! array_key_exists('wrapped', $payload)) {
            return null;
        }

        $releases = is_array($payload['wrapped']) ? ($payload['wrapped']['releases'] ?? []) : null;

        if (! is_array($releases)) {
            $errors['wrapped.releases'] = (string) __('content.remote.wrapped_release');

            return null;
        }

        $normalized = [];

        foreach ($releases as $season => $at) {
            $date = is_string($at) && preg_match('/\A\d{4}-\d{2}-\d{2}T\d{2}:\d{2}(:\d{2})?(Z|[+-]\d{2}:\d{2})\z/', $at) === 1 ? date_create_immutable($at) : false;

            if (Season::tryFrom($season) === null || $date === false) {
                $errors['wrapped.releases.'.$season] = (string) __('content.remote.wrapped_release');

                continue;
            }

            $normalized[(string) $season] = $date->format(DATE_ATOM);
            $at = CarbonImmutable::instance($date);
            $published = $this->publishedRelease((string) $season);

            if ($published !== null && $published->equalTo($at)) {
                continue;
            }

            $end = Season::from((string) $season)->toUtc();
            $earliest = CarbonImmutable::now()->addDay();
            $zone = config()->string('speedclub.wrapped.timezone');

            if ($at->lessThanOrEqualTo($end)) {
                $errors['wrapped.releases.'.$season] = (string) __('content.remote.wrapped_release_season', ['date' => $end->setTimezone($zone)->format('d.m.Y H:i')]);
            } elseif ($at->lessThan($earliest)) {
                $errors['wrapped.releases.'.$season] = (string) __('content.remote.wrapped_release_soon', ['date' => $earliest->setTimezone($zone)->format('d.m.Y H:i')]);
            }
        }

        ksort($normalized);

        return $normalized;
    }

    /**
     * The release of $season in the published remote config, if any (read directly: the schema registry builds ConfigVersions).
     */
    private function publishedRelease(string $season): ?CarbonImmutable
    {
        $payload = ConfigVersion::query()->where('key', ConfigKey::RemoteConfig->value)->where('status', ConfigVersionStatus::Published)
            ->orderByDesc('version')->value('payload');
        $value = is_array($payload) && is_array($payload['wrapped']['releases'] ?? null) ? ($payload['wrapped']['releases'][$season] ?? null) : null;

        if (! is_string($value)) {
            return null;
        }

        $date = date_create_immutable($value);

        return $date === false ? null : CarbonImmutable::instance($date);
    }

    public function initial(): array
    {
        $defaults = config()->array('speedclub.app_config.remote_config');

        return [
            'min_version' => $defaults['min_version'],
            'latest_version' => $defaults['latest_version'],
            'force_update_message' => null,
            'maintenance' => ['enabled' => false, 'message' => null],
        ];
    }

    public function approvalFor(array $live, array $next): ?string
    {
        $was = is_array($live['maintenance'] ?? null) && ($live['maintenance']['enabled'] ?? false) === true;
        $will = is_array($next['maintenance'] ?? null) && ($next['maintenance']['enabled'] ?? false) === true;

        return ! $was && $will ? 'maintenance.enable' : null;
    }
}
