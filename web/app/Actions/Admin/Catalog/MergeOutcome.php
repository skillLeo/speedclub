<?php

namespace App\Actions\Admin\Catalog;

use App\Models\ApprovalRequest;

/**
 * What a merge answers: it ran (`summary`: survivor, vehicles before and after, what moved; the relink and search rebuild follow in the
 * queue), or it waits for a second staff member (more than 100 affected vehicles in the rolling 24 h window, ADR-229).
 */
final readonly class MergeOutcome
{
    /**
     * @param  array<string, mixed>|null  $summary
     */
    public function __construct(public ?array $summary = null, public ?ApprovalRequest $approval = null) {}

    public function waitsForApproval(): bool
    {
        return $this->approval !== null;
    }
}
