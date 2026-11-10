<?php

namespace App\Services\Team;

use DomainException;

/**
 * A Team, account, privacy, system or memberships step the rules of m3.6 §1 refuse (the world, not the input). `reason` is the key the
 * admin translates (`team.refused.<reason>` in lang/{de,en}/team.php, also usable by the admin's own JSON); a DomainException, so a
 * four-eyes execution ends as failed instead of half done.
 *
 * Reasons: last_owner, max_owners, owner_only, self, self_elevation, atoms_not_held, unchanged, deactivated, not_deactivated, deleted,
 * not_invited, invite_invalid, role_locked, role_system, role_in_use, role_taken, no_two_factor, code_invalid, too_many_codes,
 * no_rotation, rotation_elsewhere, rotation_expired, current_session, session_unknown, already_extended, past_due, final, no_member,
 * nothing_to_export, export_running, no_address, wrong_type, evidence_required, note_required, not_configured, no_device,
 * job_unknown, plan_inactive, already_revoked, ends_before_start, changed, role_pending_approval (SEC-P3-13).
 */
final class TeamRefused extends DomainException
{
    /**
     * @param  array<string, scalar|null>  $context
     */
    public function __construct(public readonly string $reason, public readonly array $context = [])
    {
        parent::__construct((string) __("team.refused.$reason", array_map(fn (mixed $value): string => (string) $value, $context)));
    }

    /** The HTTP status the admin answers with. */
    public function status(): int
    {
        return match ($this->reason) {
            'too_many_codes' => 429,
            'rotation_elsewhere', 'export_running', 'role_pending_approval' => 409,
            default => 422,
        };
    }
}
