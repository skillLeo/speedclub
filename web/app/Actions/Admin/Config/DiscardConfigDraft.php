<?php

namespace App\Actions\Admin\Config;

use App\Enums\ConfigKey;
use App\Models\Staff;
use App\Services\Config\ConfigRefused;
use App\Services\Config\ConfigVersions;
use Illuminate\Auth\Access\AuthorizationException;
use Illuminate\Validation\ValidationException;

/**
 * "Entwurf verwerfen": the creator discards their draft (editAtom); a staff member with the key's publishAtom may discard someone
 * else's with a reason (a draft left behind would block the key). Audited as `config.draft_discarded`.
 */
final class DiscardConfigDraft
{
    public function __construct(private readonly ConfigVersions $versions) {}

    /**
     * @throws AuthorizationException|ValidationException|ConfigRefused
     */
    public function handle(Staff $staff, ConfigKey $key, ?string $reason = null): void
    {
        $this->versions->discardDraft($staff, $key, $reason);
    }
}
