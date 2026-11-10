<?php

namespace App\Actions\Admin\Settings;

use App\Enums\ConfigKey;
use App\Models\ConfigVersion;
use App\Models\Staff;
use App\Services\Admin\Members\StaffAtoms;
use App\Services\Catalog\Reason;
use App\Services\Config\ConfigRefused;
use App\Services\Config\ConfigVersions;
use App\Services\Team\TeamRefused;
use Illuminate\Auth\Access\AuthorizationException;
use Illuminate\Support\Facades\DB;
use Illuminate\Validation\ValidationException;

/**
 * ADM-52 "Speichern" (Owner only, with reason): the org identity (OrgIdentity::FIELDS) drafted and published in one step through the
 * config engine (`org`, OrgSchema). The legal placeholders resolve from the new version at once; the support address of the mails too.
 * History and rollback as for every config key.
 *
 * @throws AuthorizationException|ValidationException|ConfigRefused|TeamRefused
 */
class UpdateOrgSettings
{
    public function __construct(private readonly ConfigVersions $versions) {}

    /**
     * @param  array<array-key, mixed>  $values
     */
    public function handle(Staff $by, array $values, string $reason): ConfigVersion
    {
        StaffAtoms::ensure($by, ConfigKey::Org->editAtom());

        if (! $by->isOwner()) {
            throw new AuthorizationException;
        }

        $reason = Reason::required($reason);

        return DB::transaction(function () use ($by, $values, $reason): ConfigVersion {
            $draft = $this->versions->draft(ConfigKey::Org);
            $revision = $draft !== null && $draft->created_by === $by->getKey() ? $draft->revision : null;
            $saved = $this->versions->saveDraft($by, ConfigKey::Org, $values, $revision);

            return $this->versions->publish($by, ConfigKey::Org, $reason, $saved->revision);
        });
    }
}
