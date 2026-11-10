<?php

namespace App\Actions\Admin\Config;

use App\Models\ApprovalRequest;
use App\Models\FeatureFlag;

final readonly class FlagOutcome
{
    public function __construct(public ?FeatureFlag $flag = null, public ?ApprovalRequest $approval = null) {}

    public function waitsForApproval(): bool
    {
        return $this->approval !== null;
    }
}
