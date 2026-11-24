<?php

namespace App\Actions\Admin\Settings;

use App\Enums\ApprovalEvent;
use App\Enums\ConfigKey;
use App\Enums\StaffAlertKind;
use App\Enums\StaffSecurityEvent;
use App\Models\ConfigVersion;
use App\Models\Staff;
use App\Services\Admin\Members\StaffAtoms;
use App\Services\Approvals\OwnerOverride;
use App\Services\Audit\Audit;
use App\Services\Catalog\Reason;
use App\Services\Config\ConfigRefused;
use App\Services\Config\ConfigVersions;
use App\Services\Governance\Governance;
use App\Services\Team\StaffAlerts;
use Illuminate\Auth\Access\AuthorizationException;
use Illuminate\Support\Facades\DB;
use Illuminate\Validation\ValidationException;

/**
 * ADM-52 Governance "Speichern" ⚿ (M5.1, ADR-507, ADR-540, Owner only): the Owner-Override switch, "Vier-Augen-Prinzip" and "2FA für
 * Admin-Konten" drafted and published in one step through the config engine (`governance`, GovernanceSchema), so every change is a
 * version (`config.published`, ADM-35). A switch left out (null) keeps its live value. ADR-540: a change of four-eyes is also audited
 * as `approval.four_eyes_switched`, a change of the 2FA mode as `staff.two_factor_policy_changed` (both before/after).
 * SEC-P5-03: when the switch actually turns on or off it is also audited as `approval.owner_override_switched` (before/after) and every
 * active Owner and Admin gets OwnerOverrideSwitchMail (StaffAlerts, queued with retries), so one Owner never changes it unnoticed.
 */
final class UpdateGovernanceSettings
{
    public function __construct(
        private readonly ConfigVersions $versions,
        private readonly OwnerOverride $override,
        private readonly StaffAlerts $alerts,
    ) {}

    /**
     * @throws AuthorizationException|ValidationException|ConfigRefused
     */
    public function handle(Staff $by, bool $ownerOverride, string $reason = '', ?bool $fourEyes = null, ?string $staffTwoFactor = null): ConfigVersion
    {
        StaffAtoms::ensure($by, ConfigKey::Governance->editAtom());

        if (! $by->isOwner()) {
            throw new AuthorizationException;
        }

        $reason = Reason::internal($reason);

        return DB::transaction(function () use ($by, $ownerOverride, $reason, $fourEyes, $staffTwoFactor): ConfigVersion {
            $before = $this->override->enabled(lock: true);
            $fourEyesBefore = Governance::fourEyes(lock: true);
            $twoFactorBefore = Governance::twoFactorMode();
            $fourEyes ??= $fourEyesBefore;
            $staffTwoFactor ??= $twoFactorBefore;
            $draft = $this->versions->draft(ConfigKey::Governance);
            $revision = $draft !== null && $draft->created_by === $by->getKey() ? $draft->revision : null;
            $saved = $this->versions->saveDraft($by, ConfigKey::Governance, ['owner_override' => $ownerOverride, 'four_eyes' => $fourEyes, 'staff_two_factor' => $staffTwoFactor], $revision);
            $published = $this->versions->publish($by, ConfigKey::Governance, $reason, $saved->revision);

            if ($fourEyesBefore !== $fourEyes) {
                Audit::record(ApprovalEvent::FourEyesSwitched->value, $published,
                    before: ['four_eyes' => $fourEyesBefore],
                    after: ['four_eyes' => $fourEyes, 'version' => $published->version],
                    reason: $reason, actor: $by);
            }

            if ($twoFactorBefore !== $staffTwoFactor) {
                Audit::record(StaffSecurityEvent::TwoFactorPolicyChanged->value, $published,
                    before: ['staff_two_factor' => $twoFactorBefore],
                    after: ['staff_two_factor' => $staffTwoFactor, 'version' => $published->version],
                    reason: $reason, actor: $by);
            }

            if ($before !== $ownerOverride) {
                Audit::record(ApprovalEvent::OwnerOverrideSwitched->value, $published,
                    before: ['owner_override' => $before],
                    after: ['owner_override' => $ownerOverride, 'version' => $published->version],
                    reason: $reason, actor: $by);

                $this->alerts->queue(StaffAlertKind::OverrideSwitch, 'governance:'.$published->version, StaffAlerts::ownersAndAdmins(), [
                    'actor' => (string) $by->name,
                    'enabled' => $ownerOverride ? '1' : '0',
                    'reason' => $reason,
                    'at' => now()->timezone((string) config('speedclub.notifications.timezone', 'Europe/Berlin'))->format('d.m.Y H:i'),
                ]);
            }

            return $published;
        });
    }
}
