<?php

namespace App\Actions\Admin\Moderation;

use App\Enums\ConfigVersionStatus;
use App\Models\ConfigVersion;
use App\Models\Staff;
use App\Services\Admin\Members\StaffAtoms;
use App\Services\Audit\Audit;
use App\Services\Rules\RateLimitOverrides;
use Illuminate\Auth\Access\AuthorizationException;
use Illuminate\Support\Facades\DB;
use Illuminate\Validation\ValidationException;

/**
 * ADM-23 rate-limit overrides (`moderation.rules`, recent password, reason; m3.4-contract §1): the complete set of overrides becomes the
 * published config version `rate_limits` (the earlier one superseded), each value within 0.25× to 4× of the configured default; null or
 * the default itself removes an override. After the commit the set is written to the cache, where RateLimits reads it at boot.
 * Audited `moderation.rate_limits_published` with the set before and after.
 *
 * @throws AuthorizationException|ValidationException
 */
class PublishRateLimits
{
    /**
     * @param  array<mixed>  $overrides  limiter name => max (int) or null
     */
    public function handle(Staff $staff, array $overrides, string $reason): ConfigVersion
    {
        StaffAtoms::ensure($staff, 'moderation.rules');
        $defaults = RateLimitOverrides::defaults();
        $clean = [];
        $errors = [];

        foreach ($overrides as $name => $value) {
            if (! is_string($name) || ! isset($defaults[$name])) {
                $errors['overrides'] = [(string) __('validation.in', ['attribute' => 'limiter'])];

                continue;
            }

            if ($value === null || $value === '' || (int) $value === $defaults[$name]['max']) {
                continue;
            }

            $bounds = RateLimitOverrides::bounds($defaults[$name]['max']);

            if (! is_numeric($value) || (int) $value != $value || (int) $value < $bounds['min'] || (int) $value > $bounds['max']) {
                $errors["overrides.$name"] = [(string) __('validation.between.numeric', ['attribute' => $name, 'min' => $bounds['min'], 'max' => $bounds['max']])];

                continue;
            }

            $clean[$name] = (int) $value;
        }

        if ($errors !== []) {
            throw ValidationException::withMessages($errors);
        }

        ksort($clean);

        $version = DB::transaction(function () use ($staff, $clean, $reason): ConfigVersion {
            $live = ConfigVersion::query()->where('key', RateLimitOverrides::CONFIG_KEY)->where('status', ConfigVersionStatus::Published)->lockForUpdate()->first();
            $previous = $live instanceof ConfigVersion ? ($live->payload['overrides'] ?? null) : null;
            $before = is_array($previous) ? $previous : [];
            $number = (int) ConfigVersion::query()->where('key', RateLimitOverrides::CONFIG_KEY)->max('version') + 1;

            ConfigVersion::query()->where('key', RateLimitOverrides::CONFIG_KEY)->where('status', ConfigVersionStatus::Published)
                ->update(['status' => ConfigVersionStatus::Superseded->value, 'updated_at' => now()]);

            $version = new ConfigVersion;
            $version->forceFill([
                'key' => RateLimitOverrides::CONFIG_KEY,
                'version' => $number,
                'status' => ConfigVersionStatus::Published,
                'payload' => ['overrides' => (object) $clean],
                'created_by' => $staff->id,
                'published_by' => $staff->id,
                'published_at' => now(),
                'reason' => trim($reason),
            ])->save();

            Audit::record('moderation.rate_limits_published', $version, ['overrides' => $before], ['overrides' => $clean, 'version' => $number], trim($reason), $staff);

            return $version;
        });

        DB::afterCommit(fn () => RateLimitOverrides::remember($clean));

        return $version;
    }
}
