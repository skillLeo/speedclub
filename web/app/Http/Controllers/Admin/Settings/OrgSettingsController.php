<?php

namespace App\Http\Controllers\Admin\Settings;

use App\Actions\Admin\Settings\UpdateGovernanceSettings;
use App\Actions\Admin\Settings\UpdateOrgSettings;
use App\Enums\ConfigKey;
use App\Enums\ConfigVersionStatus;
use App\Enums\StaffStatus;
use App\Http\Controllers\Admin\Settings\Requests\GovernanceSettingsRequest;
use App\Http\Controllers\Admin\Settings\Requests\OrgSettingsRequest;
use App\Http\Controllers\Admin\Team\TeamResponses;
use App\Http\Controllers\Controller;
use App\Models\ConfigVersion;
use App\Models\Staff;
use App\Services\Approvals\Approvals;
use App\Services\Approvals\OwnerOverride;
use App\Services\Governance\Governance;
use App\Services\Privacy\OrgIdentity;
use Illuminate\Http\RedirectResponse;
use Illuminate\Http\Request;
use Inertia\Inertia;
use Inertia\Response;

/**
 * ADM-52 org settings (06 §3 Settings, m3.6 §1, ADR-239): the company identity for the Impressum, the legal texts and the mails (17
 * fields of OrgSchema), each with the `[[…]]` placeholder of the legal documents it fills; the support address the mails name and the
 * platform's default locale. Saving publishes a new version of the config key `org` (Owner only, recent password; ADR-540: no reason); an Admin reads
 * it, with a notice naming the Owners who can change it (`owners`). OA-10: the real values come from the owner. M5.1 Governance
 * (ADR-507): the Owner-Override switch (config key `governance`) and who can approve four-eyes requests today, so an Owner sees whether a
 * request of theirs could ever be approved by someone else.
 */
class OrgSettingsController extends Controller
{
    use TeamResponses;

    public function show(Request $request, OrgIdentity $org, OwnerOverride $override, Approvals $approvals): Response
    {
        /** @var Staff $viewer */
        $viewer = $request->user('staff');
        $last = ConfigVersion::query()->where('key', ConfigKey::Org->value)->where('status', ConfigVersionStatus::Published)->orderByDesc('version')->with('publisher:id,name')->first();

        return Inertia::render('Settings/Index', [
            'values' => fn (): array => $org->values(),
            'fields' => OrgIdentity::FIELDS,
            'emailFields' => OrgIdentity::EMAIL_FIELDS,
            'placeholders' => array_flip(OrgIdentity::PLACEHOLDERS),
            'locales' => config('speedclub.locales'),
            'lastPublished' => $last === null ? null : ['version' => $last->version, 'at' => $last->published_at?->toIso8601String(), 'by' => $last->publisher?->name],
            'canEdit' => $viewer->isOwner(),
            // Client report 2026-11-23: the client's Admin account saw disabled fields and no Save, with nothing saying who can change them.
            'owners' => fn (): array => $viewer->isOwner() ? [] : self::owners(),
            'governance' => fn (): array => [
                'owner_override' => $override->enabled(),
                // ADR-540: "Vier-Augen-Prinzip" (default off) and "2FA für Admin-Konten" (default optional; `two_factor_forced` when the
                // deployment's STAFF_2FA_REQUIRED=true holds it at Pflicht).
                'four_eyes' => Governance::fourEyes(),
                'staff_two_factor' => Governance::twoFactorMode(),
                'two_factor_forced' => Governance::twoFactorForced(),
                'approvers' => self::approvers($approvals),
            ],
        ]);
    }

    public function update(OrgSettingsRequest $request, UpdateOrgSettings $update): RedirectResponse
    {
        return $this->step(fn () => $update->handle($request->staff(), $request->values(), $request->reason()), 'settings.flash.saved');
    }

    public function updateGovernance(GovernanceSettingsRequest $request, UpdateGovernanceSettings $update): RedirectResponse
    {
        return $this->step(fn () => $update->handle($request->staff(), $request->ownerOverride(), $request->reason(), $request->fourEyes(), $request->staffTwoFactor()), 'settings.flash.governance_saved');
    }

    /**
     * The active Owners by name, for the notice a reader of ADM-52 sees: only they change the company data (ADR-239).
     *
     * @return list<string>
     */
    private static function owners(): array
    {
        return array_values(Staff::query()->whereHas('roles', fn ($roles) => $roles->where('name', 'owner'))->where('status', StaffStatus::Active)->whereNull('anonymised_at')
            ->orderBy('name')->pluck('name')->map(fn (mixed $name): string => (string) $name)->all());
    }

    /**
     * The staff who can decide approvals today (Approvals::approverCandidates(), the one definition of ADR-507 shared with the pending
     * notices, SF-2), with approvals.decide, by name; `id` keys the list (N-5).
     *
     * @return list<array{id: int, name: string, owner: bool}>
     */
    private static function approvers(Approvals $approvals): array
    {
        return array_values($approvals->approverCandidates()
            ->filter(fn (Staff $staff): bool => $staff->can('approvals.decide'))
            ->map(fn (Staff $staff): array => ['id' => (int) $staff->getKey(), 'name' => (string) $staff->name, 'owner' => $staff->isOwner()])
            ->all());
    }
}
