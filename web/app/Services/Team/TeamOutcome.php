<?php

namespace App\Services\Team;

use App\Models\ApprovalRequest;

/**
 * What a Team or privacy step did: applied at once, or asked for a four-eyes approval (the page then shows ApprovalNotice). Both may be
 * true for an invite: the account exists with its plain roles, the elevating ones wait for the approval.
 */
final readonly class TeamOutcome
{
    public function __construct(public bool $applied, public ?ApprovalRequest $approval = null) {}

    public static function applied(): self
    {
        return new self(true);
    }

    public static function approval(ApprovalRequest $approval, bool $applied = false): self
    {
        return new self($applied, $approval);
    }
}
