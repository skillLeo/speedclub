<?php

namespace App\Services\Approvals;

use App\Models\ApprovalRequest;
use App\Models\Staff;
use Illuminate\Validation\ValidationException;

/**
 * One four-eyes action (ADR-214). A class in app/Services/Approvals/Handlers implementing this is found by HandlerRegistry; no shared
 * file lists them. The payload is what the requesting page sent, already in the handler's own terms.
 */
interface ApprovalHandler
{
    /** The action name, e.g. "moderation.suspend". At most 80 characters. */
    public function key(): string;

    /** The permission atom both the requester and the approver must hold. */
    public function atom(): string;

    /**
     * Whether only an Owner may approve: actions that touch an Owner or grant Owner, Admin or roles.manage. A handler whose answer
     * depends on the payload also implements ChecksPayloadAtoms (atomsFor() may return []), so Approvals::countFor() reads its payloads.
     *
     * @param  array<string, mixed>  $payload
     */
    public function requiresOwner(array $payload): bool;

    /**
     * At the request and again right before execution. Throws when the payload is malformed or the world changed (the case closed,
     * the member is gone): at the request the page shows the errors, at the approval the request ends as failed.
     *
     * @param  array<string, mixed>  $payload
     *
     * @throws ValidationException
     */
    public function validate(array $payload): void;

    /**
     * What the approval queue shows. title and each line's label are i18n keys of the admin (web/lang/admin/<locale>/approvals.json);
     * subject_label, before and after are data (a username, an ISO date, an enum value; null means none or no end).
     *
     * @param  array<string, mixed>  $payload
     * @return array{title: string, subject_label: string|null, lines: list<array{label: string, before?: string|null, after?: string|null}>}
     */
    public function describe(array $payload): array;

    /**
     * Runs inside the approving transaction (after it, record by record, for RunsRecordByRecord). Starts with FourEyes::handler(), so
     * nobody but Approvals::approve() can run it. Writes the action's own audit event, naming requester and approver. Returns what the
     * requester sees afterwards (ids, counts, a file); never a secret.
     *
     * @return array<string, mixed>
     */
    public function execute(ApprovalRequest $request, Staff $approver): array;
}
