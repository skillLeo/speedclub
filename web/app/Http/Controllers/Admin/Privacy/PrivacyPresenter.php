<?php

namespace App\Http\Controllers\Admin\Privacy;

use App\Actions\Admin\Privacy\SendPrivacyReply;
use App\Models\PrivacyRequest;
use App\Models\Staff;
use App\Models\User;
use App\Services\Admin\Members\MemberRecord;
use Carbon\CarbonImmutable;

/**
 * Rows of ADM-45/46. The requester's address is masked for every role (the reply goes to it without anyone reading it); a member shows as
 * `@username` with a link. Never the evidence path.
 *
 * One clock (DQ-617): how a deadline reads (days left or overdue, the ≤ N-days emphasis) is decided here, with the page's clock
 * (`QaClock::now()`, the real time outside the visual matrix), never by the browser against seeded dates.
 */
final class PrivacyPresenter
{
    /**
     * @param  list<PrivacyRequest>  $requests  with member and assignee loaded
     * @return list<array<string, mixed>>
     */
    public static function rows(array $requests, Staff $viewer, CarbonImmutable $now): array
    {
        return array_map(fn (PrivacyRequest $request): array => self::row($request, $viewer, $now), $requests);
    }

    /**
     * @return array<string, mixed>
     */
    public static function row(PrivacyRequest $request, Staff $viewer, CarbonImmutable $now): array
    {
        return [
            'id' => $request->id,
            'reference' => SendPrivacyReply::reference($request),
            'type' => $request->type->value,
            'article' => $request->type->article(),
            'status' => $request->status->value,
            'source' => $request->source->value,
            'requester' => self::requester($request),
            'received_at' => $request->received_at->toIso8601String(),
            'due_at' => $request->due_at->toIso8601String(),
            'extended' => $request->extended_at !== null,
            'due' => self::due($request, $now),
            'completed_at' => $request->completed_at?->toIso8601String(),
            'assigned' => $request->assignee instanceof Staff ? ['id' => $request->assignee->id, 'name' => $request->assignee->name, 'me' => $request->assignee->id === $viewer->id] : null,
        ];
    }

    /**
     * The deadline as the page shows it: `state` overdue (red), soon (≤ due_soon_days, amber), later, or done for a closed request;
     * `days` are calendar days in Berlin (left, or past for an overdue one, at least 1).
     *
     * @return array{state: 'overdue'|'soon'|'later'|'done', days: int}
     */
    public static function due(PrivacyRequest $request, CarbonImmutable $now): array
    {
        if ($request->status->isFinal()) {
            return ['state' => 'done', 'days' => 0];
        }

        $today = $now->setTimezone('Europe/Berlin')->startOfDay();
        $dueDay = CarbonImmutable::instance($request->due_at)->setTimezone('Europe/Berlin')->startOfDay();
        $days = (int) round($today->diffInDays($dueDay, false));

        if ($request->due_at->lessThanOrEqualTo($now)) {
            return ['state' => 'overdue', 'days' => max(1, -$days)];
        }

        return ['state' => $days <= config()->integer('speedclub.privacy.due_soon_days') ? 'soon' : 'later', 'days' => max(0, $days)];
    }

    /**
     * @return array{kind: 'member'|'external', id: string|null, username: string|null, deleted: bool, name: string|null, email: string|null}
     */
    public static function requester(PrivacyRequest $request): array
    {
        $member = $request->member;
        $email = $request->requester_email;

        return [
            'kind' => $request->user_id !== null ? 'member' : 'external',
            'id' => $member instanceof User ? $member->id : null,
            'username' => $member instanceof User ? $member->username : null,
            'deleted' => $member instanceof User && $member->trashed(),
            'name' => $request->requester_name,
            'email' => is_string($email) && $email !== '' ? MemberRecord::maskEmail($email) : null,
        ];
    }

    /**
     * Active staff who may process requests, for the assignment select.
     *
     * @return list<array{id: int, name: string}>
     */
    public static function assignees(): array
    {
        return array_values(Staff::query()->where('status', 'active')->whereNull('anonymised_at')->where('password_proof_required', false)
            ->orderBy('name')->get(['id', 'name'])
            ->filter(fn (Staff $staff): bool => $staff->can('privacy.process'))
            ->map(fn (Staff $staff): array => ['id' => $staff->id, 'name' => $staff->name])
            ->all());
    }
}
