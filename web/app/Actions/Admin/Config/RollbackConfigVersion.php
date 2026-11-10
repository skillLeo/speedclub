<?php

namespace App\Actions\Admin\Config;

use App\Enums\ConfigKey;
use App\Enums\ConfigVersionStatus;
use App\Models\ConfigVersion;
use App\Models\Staff;
use App\Services\Admin\Members\StaffAtoms;
use App\Services\Approvals\Approvals;
use App\Services\Catalog\Reason;
use App\Services\Config\ConfigRefused;
use App\Services\Config\ConfigVersions;
use Illuminate\Auth\Access\AuthorizationException;
use Illuminate\Validation\ValidationException;

/**
 * ADM-35 "Zurückrollen" ⚿: a copy of an older version is published as the newest one ("Rollback auf vN: <reason>",
 * `config.rolled_back` with the diff); history is never edited. A rollback that turns maintenance on is four-eyes like a publish.
 */
final class RollbackConfigVersion
{
    public function __construct(private readonly ConfigVersions $versions, private readonly Approvals $approvals) {}

    /**
     * @throws AuthorizationException|ValidationException|ConfigRefused
     */
    public function handle(Staff $staff, ConfigKey $key, int $version, string $reason): ConfigOutcome
    {
        StaffAtoms::ensure($staff, $key->publishAtom());
        $reason = Reason::required($reason);
        $target = ConfigVersion::query()->where('key', $key->value)->where('version', $version)->where('status', ConfigVersionStatus::Superseded)->first();
        $action = $target === null ? null : $this->versions->approvalFor($key, $target->payload);

        if ($target === null || $action === null) {
            return new ConfigOutcome($this->versions->rollback($staff, $key, $version, $reason));
        }

        return new ConfigOutcome(approval: $this->approvals->request($action, [
            'key' => $key->value,
            'mode' => 'rollback',
            'version' => $version,
        ], $reason, $staff, $target));
    }
}
