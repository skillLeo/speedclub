<?php

namespace App\Actions\Admin\Content;

use App\Models\ApprovalRequest;
use App\Models\LegalDocument;

final readonly class LegalOutcome
{
    public function __construct(public ?LegalDocument $document = null, public ?ApprovalRequest $approval = null) {}

    public function waitsForApproval(): bool
    {
        return $this->approval !== null;
    }
}
