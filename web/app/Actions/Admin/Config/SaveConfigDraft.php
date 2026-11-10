<?php

namespace App\Actions\Admin\Config;

use App\Enums\ConfigKey;
use App\Models\ConfigVersion;
use App\Models\Staff;
use App\Services\Config\ConfigRefused;
use App\Services\Config\ConfigVersions;
use Illuminate\Auth\Access\AuthorizationException;
use Illuminate\Validation\ValidationException;

/**
 * ADM-28/29/30/37 (and ADM-23's rate limits, M3.6's org): save the staff member's draft of a config key (ConfigKey::editAtom()). The
 * payload shape is the key's schema (App\Services\Config\Schemas); `revision` is the draft revision the page loaded (null without one).
 * Audited as `config.draft_saved` with the diff against the previous draft (or the live version).
 */
final class SaveConfigDraft
{
    public function __construct(private readonly ConfigVersions $versions) {}

    /**
     * @param  array<array-key, mixed>  $payload
     *
     * @throws AuthorizationException|ValidationException|ConfigRefused
     */
    public function handle(Staff $staff, ConfigKey $key, array $payload, ?int $revision): ConfigVersion
    {
        return $this->versions->saveDraft($staff, $key, $payload, $revision);
    }
}
