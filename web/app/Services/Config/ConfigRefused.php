<?php

namespace App\Services\Config;

use DomainException;

/**
 * A config, content or flag change the rules of m3.5 §1 refuse (the world, not the input). `reason` is the key the admin page translates
 * (`config.refused.<reason>`); a DomainException, so a four-eyes execution ends as failed instead of half done.
 *
 * Reasons: draft_taken (another staff member's draft, 409), stale_revision (the draft changed since it was loaded, 409), no_draft,
 * already_live, version_missing, approval_required (the change is four-eyes: ask Approvals), unchanged (the draft equals the
 * live version), ai_provider_missing, legal_not_draft, legal_version_taken, legal_pending_approval (a re-consent publish of
 * the draft waits for approval), legal_changed (the draft is no longer what the approval pinned), template_fixed, template_unknown, release_taken.
 */
final class ConfigRefused extends DomainException
{
    /**
     * @param  array<string, scalar|null>  $context
     */
    public function __construct(public readonly string $reason, public readonly array $context = [])
    {
        parent::__construct("config.refused.$reason");
    }

    /** The HTTP status the admin answers with. */
    public function status(): int
    {
        return in_array($this->reason, ['draft_taken', 'stale_revision'], true) ? 409 : 422;
    }
}
