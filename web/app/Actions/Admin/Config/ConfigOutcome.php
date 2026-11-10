<?php

namespace App\Actions\Admin\Config;

use App\Models\ApprovalRequest;
use App\Models\ConfigVersion;

/**
 * A publish or rollback: either the new live version or, for a four-eyes change, the pending approval.
 */
final readonly class ConfigOutcome
{
    public function __construct(public ?ConfigVersion $version = null, public ?ApprovalRequest $approval = null) {}

    public function waitsForApproval(): bool
    {
        return $this->approval !== null;
    }
}
