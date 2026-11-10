<?php

namespace App\Actions\Admin\Config;

use App\Enums\ConfigKey;
use App\Models\Staff;
use App\Services\Admin\Members\StaffAtoms;
use App\Services\Approvals\Approvals;
use App\Services\Catalog\Reason;
use App\Services\Config\ConfigRefused;
use App\Services\Config\ConfigVersions;
use Illuminate\Auth\Access\AuthorizationException;
use Illuminate\Validation\ValidationException;

/**
 * "Veröffentlichen" ⚿ (06 §1.5): the staff member's draft goes live with a reason (`config.published` with the JSON diff, AppConfig
 * flushed, new ETag). A change the schema calls four-eyes (remote_config turning maintenance on → `maintenance.enable`) is not executed:
 * the approval is requested and returned; its handler publishes inside the approval.
 */
final class PublishConfigVersion
{
    public function __construct(private readonly ConfigVersions $versions, private readonly Approvals $approvals) {}

    /**
     * @throws AuthorizationException|ValidationException|ConfigRefused
     */
    public function handle(Staff $staff, ConfigKey $key, string $reason, int $revision): ConfigOutcome
    {
        StaffAtoms::ensure($staff, $key->publishAtom());
        $reason = Reason::required($reason);
        $action = $this->versions->approvalFor($key);

        if ($action === null) {
            return new ConfigOutcome($this->versions->publish($staff, $key, $reason, $revision));
        }

        $draft = $this->versions->draft($key);

        if ($draft === null) {
            throw new ConfigRefused('no_draft');
        }

        if ($draft->created_by !== $staff->getKey()) {
            throw new ConfigRefused('draft_taken');
        }

        if ($draft->revision !== $revision) {
            throw new ConfigRefused('stale_revision', ['revision' => $draft->revision]);
        }

        return new ConfigOutcome(approval: $this->approvals->request($action, [
            'key' => $key->value,
            'mode' => 'publish',
            'draft_id' => $draft->id,
            'revision' => $draft->revision,
        ], $reason, $staff, $draft));
    }
}
