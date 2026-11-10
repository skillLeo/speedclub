<?php

namespace App\Services\Approvals;

use App\Enums\ApprovalEvent;
use App\Enums\ApprovalStatus;
use App\Models\ApprovalRequest;
use App\Models\Staff;
use App\Services\Audit\Audit;
use DomainException;
use Illuminate\Auth\Access\AuthorizationException;
use Illuminate\Database\Eloquent\Builder;
use Illuminate\Database\Eloquent\Collection;
use Illuminate\Database\Eloquent\Model;
use Illuminate\Database\UniqueConstraintViolationException;
use Illuminate\Support\Carbon;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Storage;
use Illuminate\Support\Facades\URL;
use Illuminate\Support\Facades\Validator;
use Illuminate\Support\Str;
use Illuminate\Validation\ValidationException;
use InvalidArgumentException;
use Throwable;

/**
 * The four-eyes engine (ADR-214, 06_ADMIN_SPEC §2). A four-eyes action never executes from its own endpoint: the controller calls
 * request() and answers with the pending request. It executes only in approve(): by a different, active staff member who holds
 * approvals.decide and the action's own atom (an Owner where the handler says so), within 24 hours, after the handler validated the
 * payload again, in one transaction under the request's row lock (a bulk handler runs record by record after that commit,
 * RunsRecordByRecord). Every step is audited; the executed action writes its own event. The executors refuse to run anywhere else
 * (FourEyes, Approvals::executing()).
 *
 * Errors: AuthorizationException (403) when a staff member may not ask or decide, ValidationException (422) for a bad reason, comment
 * or payload at the request, ApprovalConflict (409) when the request is no longer pending.
 */
final class Approvals
{
    /** Minutes after which an `executing` request whose run never finished (a killed PHP request) ends as failed. */
    public const EXECUTING_STALE_MINUTES = 15;

    private static ?ApprovalExecution $executing = null;

    public function __construct(private readonly HandlerRegistry $handlers) {}

    /**
     * Asks for approval. One pending request per action and subject: asking again returns the pending one (without a subject, per
     * requester and payload). Whether this call created it: the returned model's wasRecentlyCreated (false when another request, maybe
     * another staff member's with another payload, was already pending; the page then says "already pending", review N-1).
     *
     * @param  array<string, mixed>  $payload
     *
     * @throws AuthorizationException|ValidationException
     */
    public function request(string $action, array $payload, string $reason, Staff $by, ?Model $subject = null): ApprovalRequest
    {
        $handler = $this->handlers->get($action);
        $reason = trim($reason);

        Validator::make(['reason' => $reason], ['reason' => ['required', 'string', 'min:10', 'max:1000']])->validate();

        if (! $by->isActive() || ! $by->can($handler->atom())) {
            throw new AuthorizationException;
        }

        $handler->validate($payload);

        // The payload's own atoms (ChecksPayloadAtoms), once the payload is known to be well-formed.
        if (! $this->holdsAtoms($by, $handler, $payload)) {
            throw new AuthorizationException;
        }

        $summary = $handler->describe($payload);
        $key = $this->pendingKey($action, $by, $payload, $subject);

        try {
            return DB::transaction(function () use ($action, $payload, $reason, $by, $subject, $summary, $key): ApprovalRequest {
                $existing = ApprovalRequest::query()->where('pending_key', $key)->lockForUpdate()->first();

                if ($existing !== null && ! $existing->hasExpired()) {
                    return $existing;
                }

                if ($existing !== null) {
                    $this->expireLocked($existing);
                }

                $request = new ApprovalRequest;
                $request->forceFill([
                    'action' => $action,
                    'subject_type' => $subject?->getMorphClass(),
                    'subject_id' => $subject === null ? null : (string) $subject->getKey(),
                    'payload' => $payload,
                    'summary' => $summary,
                    'reason' => $reason,
                    'requested_by' => $by->getKey(),
                    'status' => ApprovalStatus::Pending,
                    'pending_key' => $key,
                    'expires_at' => now()->addHours(config()->integer('speedclub.approvals.ttl_hours')),
                ])->save();

                Audit::record(ApprovalEvent::Requested->value, $request, after: [
                    'action' => $action,
                    'subject_type' => $request->subject_type,
                    'subject_id' => $request->subject_id,
                    'expires_at' => $request->expires_at->toIso8601String(),
                ], reason: $reason, actor: $by);

                return $request;
            });
        } catch (UniqueConstraintViolationException) {
            // A parallel request for the same action and subject won.
            return ApprovalRequest::query()->where('pending_key', $key)->firstOrFail();
        }
    }

    /**
     * Executes the request. Returns it as executed, failed (the re-validation or the action refused; nothing changed), or expired.
     *
     * In one transaction under the row lock: expiry, the approver's rights, the requester's rights again, the payload again, and then
     * the handler inside a savepoint (a refusal rolls it back and ends the request as failed). A handler that runs record by record
     * (RunsRecordByRecord, the bulk actions, SF-3) is recorded as executing in that transaction instead and runs after its commit,
     * each record in its own short transaction; the request then ends as executed with the per-record rows, or failed.
     *
     * Only here does a four-eyes executor run (FourEyes, Approvals::executing()).
     *
     * @throws AuthorizationException|ApprovalConflict|ValidationException
     */
    public function approve(ApprovalRequest $request, Staff $approver, ?string $comment = null): ApprovalRequest
    {
        $comment = $this->comment($comment, required: false);

        /** @var array{0: ApprovalRequest, 1: ApprovalHandler|null} $decided */
        $decided = DB::transaction(function () use ($request, $approver, $comment): array {
            $locked = $this->lockPending($request);

            if ($locked->hasExpired()) {
                $this->expireLocked($locked);

                return [$locked, null];
            }

            $handler = $this->handlers->get($locked->action);
            $this->ensureMayDecide($locked, $approver, $handler);

            try {
                $this->ensureRequesterMayStill($locked, $handler);
                $handler->validate($locked->payload);

                if ($handler instanceof RunsRecordByRecord) {
                    $locked->forceFill([
                        'status' => ApprovalStatus::Executing,
                        'pending_key' => null,
                        'decided_by' => $approver->getKey(),
                        'decided_at' => now(),
                        'decision_comment' => $comment,
                    ])->save();

                    return [$locked, $handler];
                }

                $result = DB::transaction(fn (): array => $this->run($handler, $locked, $approver));
            } catch (ValidationException|DomainException|InvalidArgumentException $refused) {
                $this->finish($locked, ApprovalStatus::Failed, $approver, $comment, ['error' => $this->describeRefusal($refused)]);

                return [$locked, null];
            }

            $this->finish($locked, ApprovalStatus::Executed, $approver, $comment, $result);

            return [$locked, null];
        });

        [$locked, $stepwise] = $decided;

        if ($stepwise === null || $locked->status !== ApprovalStatus::Executing) {
            return $locked;
        }

        // A closed browser tab must not stop a run half-way; each record commits on its own anyway.
        ignore_user_abort(true);

        try {
            $result = $this->run($stepwise, $locked, $approver);
        } catch (ValidationException|DomainException|InvalidArgumentException $refused) {
            DB::transaction(fn () => $this->finish($locked, ApprovalStatus::Failed, $approver, $comment, ['error' => $this->describeRefusal($refused)]));

            return $locked;
        } catch (Throwable $failure) {
            DB::transaction(fn () => $this->finish($locked, ApprovalStatus::Failed, $approver, $comment, ['error' => 'interrupted']));

            throw $failure;
        }

        DB::transaction(fn () => $this->finish($locked, ApprovalStatus::Executed, $approver, $comment, $result));

        return $locked;
    }

    /**
     * The request approve() is executing right now, with its approver; null anywhere else. The four-eyes executors check it (FourEyes).
     */
    public static function executing(): ?ApprovalExecution
    {
        return self::$executing;
    }

    /**
     * @throws AuthorizationException|ApprovalConflict|ValidationException
     */
    public function deny(ApprovalRequest $request, Staff $by, string $comment): ApprovalRequest
    {
        $comment = $this->comment($comment, required: true);

        return DB::transaction(function () use ($request, $by, $comment): ApprovalRequest {
            $locked = $this->lockPending($request);
            $this->ensureMayDecide($locked, $by, $this->handlers->get($locked->action));
            $this->finish($locked, ApprovalStatus::Denied, $by, $comment, null);

            return $locked;
        });
    }

    /**
     * Only the requester withdraws a request.
     *
     * @throws AuthorizationException|ApprovalConflict
     */
    public function cancel(ApprovalRequest $request, Staff $requester): ApprovalRequest
    {
        return DB::transaction(function () use ($request, $requester): ApprovalRequest {
            $locked = $this->lockPending($request);

            if ($locked->requested_by !== $requester->getKey()) {
                throw new AuthorizationException;
            }

            $this->finish($locked, ApprovalStatus::Cancelled, $requester, null, null);

            return $locked;
        });
    }

    /**
     * What this staff member may approve now, newest first: pending, not expired, asked by someone else, and within their atoms.
     *
     * @return Collection<int, ApprovalRequest>
     */
    public function pendingFor(Staff $staff): Collection
    {
        return $this->decidableQuery($staff)
            ?->with('requester')
            ->latest()
            ->limit(200)
            ->get()
            ->filter(fn (ApprovalRequest $request): bool => $this->mayDecide($request, $staff))
            ->values() ?? new Collection;
    }

    /**
     * How many requests pendingFor() would list, for the badges (review N-2): the SQL prefilter (status, expiry, requester, the actions
     * whose atom the staff member holds) and the payload checks only for the handlers whose payload decides (ChecksPayloadAtoms), without
     * loading and decrypting every other row.
     */
    public function countFor(Staff $staff): int
    {
        $query = $this->decidableQuery($staff);

        if ($query === null) {
            return 0;
        }

        $byPayload = array_keys(array_filter($this->handlers->all(), fn (ApprovalHandler $handler): bool => $handler instanceof ChecksPayloadAtoms || $handler instanceof ConcernsStaff));
        $count = (clone $query)->whereNotIn('action', $byPayload)->count();

        (clone $query)->whereIn('action', $byPayload)->select(['id', 'action', 'payload', 'requested_by'])->lazyById(200)
            ->each(function (ApprovalRequest $request) use ($staff, &$count): void {
                $count += $this->mayDecide($request, $staff) ? 1 : 0;
            });

        return $count;
    }

    /**
     * @return Builder<ApprovalRequest>|null
     */
    private function decidableQuery(Staff $staff): ?Builder
    {
        if (! $staff->isActive() || ! $staff->can('approvals.decide')) {
            return null;
        }

        $actions = array_keys(array_filter($this->handlers->all(), fn (ApprovalHandler $handler): bool => $staff->can($handler->atom())));

        return ApprovalRequest::query()
            ->where('status', ApprovalStatus::Pending)
            ->where('expires_at', '>', now())
            ->where('requested_by', '!=', $staff->getKey())
            // ADR-237: never a request about oneself (the payload's staff_id is checked in ensureMayDecide()).
            // NULL-safe: a request without a subject (audit.export, bulk actions) stays in the list.
            ->where(fn (Builder $query) => $query->whereNull('subject_type')->orWhereNull('subject_id')
                ->orWhere('subject_type', '!=', (new Staff)->getMorphClass())
                ->orWhere('subject_id', '!=', (string) $staff->getKey()))
            ->whereIn('action', $actions);
    }

    public function mayDecide(ApprovalRequest $request, Staff $staff): bool
    {
        if (! $this->handlers->has($request->action)) {
            return false;
        }

        try {
            $this->ensureMayDecide($request, $staff, $this->handlers->get($request->action));
        } catch (AuthorizationException) {
            return false;
        }

        return true;
    }

    /**
     * Ends every pending request past its expiry, ends as failed a record-by-record run that stopped half-way (executing for more than
     * EXECUTING_STALE_MINUTES: the records it reached keep their own events), and removes export files past their download window or
     * left behind by an approval that never committed (review N-9). For approvals:expire.
     *
     * @return array{expired: int, interrupted: int, files_removed: int}
     */
    public function expire(): array
    {
        $expired = 0;

        $ids = ApprovalRequest::query()->where('status', ApprovalStatus::Pending)->where('expires_at', '<=', now())->limit(500)->pluck('id');

        foreach ($ids as $id) {
            $expired += DB::transaction(function () use ($id): int {
                $locked = ApprovalRequest::query()->whereKey($id)->lockForUpdate()->first();

                if ($locked === null || ! $locked->isPending() || ! $locked->hasExpired()) {
                    return 0;
                }

                $this->expireLocked($locked);

                return 1;
            });
        }

        return ['expired' => $expired, 'interrupted' => $this->endInterruptedRuns(), 'files_removed' => $this->removeOldFiles() + $this->removeOrphanFiles()];
    }

    /**
     * A signed link to the file an executed request produced, for its requester, valid until the end of the download window.
     */
    public function downloadUrl(ApprovalRequest $request): ?string
    {
        $until = self::downloadUntil($request);

        if ($until === null || ! $until->isFuture() || ! is_string($request->result['file'] ?? null)) {
            return null;
        }

        return URL::temporarySignedRoute('admin.approvals.download', $until, ['approval' => $request->getKey()]);
    }

    /** For the download controller: the file an executed request wrote, while its download window lasts. */
    public static function downloadableFile(ApprovalRequest $request): ?string
    {
        $file = $request->result['file'] ?? null;
        $until = self::downloadUntil($request);

        return is_string($file) && $until !== null && $until->isFuture() ? $file : null;
    }

    /**
     * Whether the requester still holds what asking needed (the action's atom and the payload's atoms) and is active, for a download.
     */
    public function requesterMayStillUse(ApprovalRequest $request, Staff $staff): bool
    {
        return $staff->isActive()
            && $request->requested_by === $staff->getKey()
            && $this->handlers->has($request->action)
            && $this->holdsAtoms($staff, $this->handlers->get($request->action), $request->payload);
    }

    public static function downloadUntil(ApprovalRequest $request): ?Carbon
    {
        return $request->executed_at?->copy()->addHours(config()->integer('speedclub.approvals.download_hours'));
    }

    /**
     * @return array<string, mixed>
     */
    private function run(ApprovalHandler $handler, ApprovalRequest $request, Staff $approver): array
    {
        $previous = self::$executing;
        self::$executing = new ApprovalExecution($request, $approver);

        try {
            return $handler->execute($request, $approver);
        } finally {
            self::$executing = $previous;
        }
    }

    /**
     * @throws ValidationException
     */
    private function ensureRequesterMayStill(ApprovalRequest $request, ApprovalHandler $handler): void
    {
        $requester = Staff::query()->find($request->requested_by);

        if ($requester === null || ! $requester->isActive() || ! $this->holdsAtoms($requester, $handler, $request->payload)) {
            throw ValidationException::withMessages(['requested_by' => ['The requester may no longer ask for this action.']]);
        }
    }

    /**
     * @throws ApprovalConflict
     */
    private function lockPending(ApprovalRequest $request): ApprovalRequest
    {
        $locked = ApprovalRequest::query()->whereKey($request->getKey())->lockForUpdate()->firstOrFail();

        if (! $locked->isPending()) {
            throw new ApprovalConflict('This request is no longer pending.');
        }

        return $locked;
    }

    /**
     * @throws AuthorizationException
     */
    private function ensureMayDecide(ApprovalRequest $request, Staff $staff, ApprovalHandler $handler): void
    {
        $allowed = $staff->isActive()
            && $staff->getKey() !== $request->requested_by
            && ! self::isAbout($request, $staff)
            && ! ($handler instanceof ConcernsStaff && $handler->concerns($request->payload, $staff))
            && $staff->can('approvals.decide')
            && $this->holdsAtoms($staff, $handler, $request->payload)
            && (! $handler->requiresOwner($request->payload) || $staff->isOwner());

        if (! $allowed) {
            throw new AuthorizationException;
        }
    }

    /**
     * Whether the request is about $staff (ADR-237: the staff member a request is about can never approve it): its subject is that staff
     * record, or its payload names them as `staff_id` (the Team handlers, NamesAStaffMember). Generic, so every handler acting on a staff
     * member is covered without a rule of its own.
     */
    public static function isAbout(ApprovalRequest $request, Staff $staff): bool
    {
        if ($request->subject_type === (new Staff)->getMorphClass() && $request->subject_id === (string) $staff->getKey()) {
            return true;
        }

        $named = $request->payload['staff_id'] ?? null;

        return is_numeric($named) && (int) $named === (int) $staff->getKey();
    }

    /**
     * The handler's atom and, for a handler whose payload decides (ChecksPayloadAtoms), the payload's atoms as well.
     *
     * @param  array<string, mixed>  $payload
     */
    private function holdsAtoms(Staff $staff, ApprovalHandler $handler, array $payload): bool
    {
        $atoms = [$handler->atom(), ...($handler instanceof ChecksPayloadAtoms ? $handler->atomsFor($payload) : [])];

        foreach ($atoms as $atom) {
            if (! $staff->can($atom)) {
                return false;
            }
        }

        return true;
    }

    /**
     * @param  array<string, mixed>|null  $result
     */
    private function finish(ApprovalRequest $request, ApprovalStatus $status, Staff $by, ?string $comment, ?array $result): void
    {
        $now = now();

        $request->forceFill([
            'status' => $status,
            'pending_key' => null,
            'decided_by' => $status === ApprovalStatus::Cancelled ? null : $by->getKey(),
            'decided_at' => $now,
            'decision_comment' => $comment,
            'executed_at' => $status === ApprovalStatus::Executed ? $now : null,
            'result' => $result,
        ])->save();

        $event = match ($status) {
            ApprovalStatus::Executed => ApprovalEvent::Approved,
            ApprovalStatus::Failed => ApprovalEvent::Failed,
            ApprovalStatus::Denied => ApprovalEvent::Denied,
            ApprovalStatus::Cancelled => ApprovalEvent::Cancelled,
            default => ApprovalEvent::Expired,
        };

        Audit::record($event->value, $request, after: [
            'action' => $request->action,
            'requested_by' => $request->requested_by,
            'decided_by' => $request->decided_by,
            'result' => $result,
        ], reason: $comment, actor: $by);
    }

    private function expireLocked(ApprovalRequest $request): void
    {
        $request->forceFill(['status' => ApprovalStatus::Expired, 'pending_key' => null, 'decided_at' => now()])->save();

        // The system ends it: no staff member decided.
        Audit::record(ApprovalEvent::Expired->value, $request, after: ['action' => $request->action, 'requested_by' => $request->requested_by]);
    }

    private function endInterruptedRuns(): int
    {
        $ended = 0;

        $ids = ApprovalRequest::query()->where('status', ApprovalStatus::Executing)
            ->where('decided_at', '<=', now()->subMinutes(self::EXECUTING_STALE_MINUTES))->limit(500)->pluck('id');

        foreach ($ids as $id) {
            $ended += DB::transaction(function () use ($id): int {
                $locked = ApprovalRequest::query()->whereKey($id)->lockForUpdate()->first();

                if ($locked === null || $locked->status !== ApprovalStatus::Executing) {
                    return 0;
                }

                $locked->forceFill(['status' => ApprovalStatus::Failed, 'result' => ['error' => 'interrupted']])->save();
                Audit::record(ApprovalEvent::Failed->value, $locked, after: [
                    'action' => $locked->action,
                    'requested_by' => $locked->requested_by,
                    'decided_by' => $locked->decided_by,
                    'result' => ['error' => 'interrupted'],
                ]);

                return 1;
            });
        }

        return $ended;
    }

    /**
     * An export file whose request is not executed (its approval rolled back after the file was written) and that is older than an
     * hour, so a run still in progress keeps its file.
     */
    private function removeOrphanFiles(): int
    {
        $disk = Storage::disk(config()->string('speedclub.media.private_disk'));
        $prefix = config()->string('speedclub.approvals.disk_prefix');
        $removed = 0;

        foreach ($disk->files($prefix) as $file) {
            $id = pathinfo($file, PATHINFO_FILENAME);

            if ($disk->lastModified($file) > now()->subHour()->getTimestamp()) {
                continue;
            }

            $owner = ApprovalRequest::query()->whereKey($id)->first(['id', 'status', 'result']);

            if ($owner !== null && $owner->status === ApprovalStatus::Executed && ($owner->result['file'] ?? null) === $file) {
                continue;
            }

            $disk->delete($file);
            $removed++;
        }

        return $removed;
    }

    private function removeOldFiles(): int
    {
        $removed = 0;
        $disk = Storage::disk(config()->string('speedclub.media.private_disk'));

        ApprovalRequest::query()
            ->where('status', ApprovalStatus::Executed)
            ->where('executed_at', '<=', now()->subHours(config()->integer('speedclub.approvals.download_hours')))
            ->whereNotNull('result')
            ->orderBy('executed_at')
            ->limit(500)
            ->get()
            ->each(function (ApprovalRequest $request) use ($disk, &$removed): void {
                $result = $request->result ?? [];
                $file = $result['file'] ?? null;

                if (! is_string($file)) {
                    return;
                }

                $disk->delete($file);
                unset($result['file']);
                $request->forceFill(['result' => [...$result, 'file_removed_at' => now()->toIso8601String()]])->save();
                $removed++;
            });

        return $removed;
    }

    /**
     * @param  array<string, mixed>  $payload
     */
    private function pendingKey(string $action, Staff $by, array $payload, ?Model $subject): string
    {
        if ($subject !== null) {
            return hash('sha256', $action.'|'.$subject->getMorphClass().'|'.$subject->getKey());
        }

        return hash('sha256', $action.'|staff:'.$by->getKey().'|'.json_encode(self::sorted($payload)));
    }

    /**
     * @param  array<array-key, mixed>  $values
     * @return array<array-key, mixed>
     */
    private static function sorted(array $values): array
    {
        ksort($values);

        return array_map(fn (mixed $value): mixed => is_array($value) ? self::sorted($value) : $value, $values);
    }

    /**
     * @throws ValidationException
     */
    private function comment(?string $comment, bool $required): ?string
    {
        $comment = $comment === null ? null : trim($comment);
        $comment = $comment === '' ? null : $comment;

        Validator::make(['comment' => $comment], ['comment' => [$required ? 'required' : 'nullable', 'string', 'min:3', 'max:1000']])->validate();

        return $comment;
    }

    private function describeRefusal(ValidationException|DomainException|InvalidArgumentException $refused): string
    {
        $message = $refused instanceof ValidationException ? (string) collect($refused->errors())->flatten()->first() : $refused->getMessage();

        return Str::limit($message, 300, '');
    }
}
