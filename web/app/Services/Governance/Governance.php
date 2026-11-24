<?php

namespace App\Services\Governance;

use App\Enums\ConfigKey;
use App\Enums\ConfigVersionStatus;
use App\Models\ConfigVersion;
use Throwable;

/**
 * The governance switches of ADM-52 "Einstellungen" (config key `governance`, GovernanceSchema), read from the live version.
 *
 * ADR-540 (client decision 2026-11-23, he owns the platform):
 * - `four_eyes` "Vier-Augen-Prinzip", default OFF: while off, every action that would ask for an approval runs at once as a direct
 *   action (Approvals::request() → `approval.direct`); the engine, tables and routes stay and behave as before once it is on again.
 * - `staff_two_factor` "2FA für Admin-Konten", `required` (Pflicht) or `optional`, default optional: optional lets a staff account
 *   sign in without TOTP and switch its own TOTP off (password confirmation only). STAFF_2FA_REQUIRED=true on a deployment forces
 *   Pflicht whatever the switch says.
 * - `owner_override` (ADR-507) is read by OwnerOverride::enabled() as before.
 *
 * A failed read answers on the safe side (four-eyes on, 2FA required); a missing key (a version published before ADR-540) the default.
 */
final class Governance
{
    public const TWO_FACTOR_REQUIRED = 'required';

    public const TWO_FACTOR_OPTIONAL = 'optional';

    /** @var list<string> */
    public const TWO_FACTOR_MODES = [self::TWO_FACTOR_REQUIRED, self::TWO_FACTOR_OPTIONAL];

    public const DEFAULT_FOUR_EYES = false;

    public const DEFAULT_TWO_FACTOR = self::TWO_FACTOR_OPTIONAL;

    /** Whether four-eyes approvals are on. */
    public static function fourEyes(bool $lock = false): bool
    {
        $payload = self::live($lock);

        if ($payload === false) {
            return true;
        }

        $value = $payload['four_eyes'] ?? null;

        return is_bool($value) ? $value : self::DEFAULT_FOUR_EYES;
    }

    /** `required` or `optional` as the switch says (the deployment's STAFF_2FA_REQUIRED aside). */
    public static function twoFactorMode(): string
    {
        $payload = self::live();

        if ($payload === false) {
            return self::TWO_FACTOR_REQUIRED;
        }

        $value = $payload['staff_two_factor'] ?? null;

        return is_string($value) && in_array($value, self::TWO_FACTOR_MODES, true) ? $value : self::DEFAULT_TWO_FACTOR;
    }

    /** Whether the deployment forces TOTP for staff (STAFF_2FA_REQUIRED=true): the switch then cannot make it optional. */
    public static function twoFactorForced(): bool
    {
        return config('speedclub.staff.two_factor_required', false) === true;
    }

    /** Whether staff need TOTP: forced by the deployment or set to Pflicht. */
    public static function staffTwoFactorRequired(): bool
    {
        return self::twoFactorForced() || self::twoFactorMode() === self::TWO_FACTOR_REQUIRED;
    }

    /**
     * The live payload, [] when none was ever published, false when it cannot be read.
     *
     * @return array<array-key, mixed>|false
     */
    private static function live(bool $lock = false): array|false
    {
        try {
            $query = ConfigVersion::query()->where('key', ConfigKey::Governance->value)->where('status', ConfigVersionStatus::Published)->orderByDesc('version');
            $live = ($lock ? $query->sharedLock() : $query)->first();
        } catch (Throwable) {
            return false;
        }

        if ($live === null) {
            return [];
        }

        $payload = $live->getAttribute('payload');

        return is_array($payload) ? $payload : false;
    }
}
