<?php

namespace App\Http\Controllers\Admin\Settings;

use App\Actions\Admin\Settings\UpdateOrgSettings;
use App\Enums\ConfigKey;
use App\Enums\ConfigVersionStatus;
use App\Http\Controllers\Admin\Settings\Requests\OrgSettingsRequest;
use App\Http\Controllers\Admin\Team\TeamResponses;
use App\Http\Controllers\Controller;
use App\Models\ConfigVersion;
use App\Models\Staff;
use App\Services\Privacy\OrgIdentity;
use Illuminate\Http\RedirectResponse;
use Illuminate\Http\Request;
use Inertia\Inertia;
use Inertia\Response;

/**
 * ADM-52 org settings (06 §3 Settings, m3.6 §1, ADR-239): the company identity for the Impressum, the legal texts and the mails (17
 * fields of OrgSchema), each with the `[[…]]` placeholder of the legal documents it fills; the support address the mails name and the
 * platform's default locale. Saving publishes a new version of the config key `org` (Owner only, reason, recent password); an Admin reads
 * it. OA-10: the real values come from the owner.
 */
class OrgSettingsController extends Controller
{
    use TeamResponses;

    public function show(Request $request, OrgIdentity $org): Response
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
        ]);
    }

    public function update(OrgSettingsRequest $request, UpdateOrgSettings $update): RedirectResponse
    {
        return $this->step(fn () => $update->handle($request->staff(), $request->values(), $request->reason()), 'settings.flash.saved');
    }
}
