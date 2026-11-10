<?php

namespace App\Services\Config;

use App\Enums\ConfigKey;
use App\Enums\ConfigVersionStatus;
use App\Enums\ContentEvent;
use App\Models\ApprovalRequest;
use App\Models\ConfigVersion;
use App\Models\Staff;
use App\Services\Admin\Members\StaffAtoms;
use App\Services\AppConfig\AppConfig;
use App\Services\Approvals\FourEyes;
use App\Services\Audit\Audit;
use App\Services\Catalog\Reason;
use App\Services\Home\HomeCuration;
use Illuminate\Auth\Access\AuthorizationException;
use Illuminate\Database\DeadlockException;
use Illuminate\Database\DetectsConcurrencyErrors;
use Illuminate\Database\Eloquent\Collection;
use Illuminate\Database\QueryException;
use Illuminate\Database\UniqueConstraintViolationException;
use Illuminate\Support\Facades\DB;
use Illuminate\Validation\ValidationException;

/**
 * The one versioning model for runtime config (m3.5 contract §1, 06_ADMIN_SPEC §1.5): per ConfigKey a series of config_versions rows,
 * at most one draft, exactly one published, the rest superseded.
 *
 * - saveDraft(): the staff member's draft, created from the live payload (or the schema's initial one) and updated with an optimistic
 *   check (`revision`: 409 stale_revision when it moved). Another staff member's draft is theirs (409 draft_taken) until it is
 *   published or discarded; so a preview token never shows one person's draft to another.
 * - publish(reason): the draft becomes the live version (renumbered after the newest row), the previous live one is superseded,
 *   `config.published` carries the JSON diff (JsonDiff) against it, and AppConfig is flushed after the commit, so GET app-config answers
 *   the new payload with a new ETag on the next request.
 * - rollback(version, reason): publishes a copy of an older version as a new version ("Rollback auf vN: …"); history is never edited.
 * A change the schema calls four-eyes (maintenance on) is refused with approval_required; the Action asks Approvals, and the handler
 * runs publishApproved()/rollbackApproved() inside the approval (FourEyes).
 *
 * Atoms are checked here, whatever the caller already did (ConfigKey::editAtom()/publishAtom(); org only by an Owner).
 */
final class ConfigVersions
{
    use DetectsConcurrencyErrors;

    public function __construct(
        private readonly ConfigSchemas $schemas,
        private readonly AppConfig $appConfig,
        private readonly HomeCuration $curation,
    ) {}

    public function live(ConfigKey $key): ?ConfigVersion
    {
        return ConfigVersion::query()->where('key', $key->value)->where('status', ConfigVersionStatus::Published)->orderByDesc('version')->first();
    }

    public function draft(ConfigKey $key): ?ConfigVersion
    {
        return ConfigVersion::query()->where('key', $key->value)->where('status', ConfigVersionStatus::Draft)->orderByDesc('version')->first();
    }

    /**
     * Published and superseded versions, newest first (ADM-35).
     *
     * @return Collection<int, ConfigVersion>
     */
    public function history(ConfigKey $key, int $limit = 100): Collection
    {
        return ConfigVersion::query()->where('key', $key->value)->where('status', '!=', ConfigVersionStatus::Draft)
            ->orderByDesc('version')->limit($limit)->get();
    }

    /**
     * What an edit page starts from: the draft's payload, else the live one, else the schema's initial payload.
     *
     * @return array<string, mixed>
     */
    public function startingPayload(ConfigKey $key): array
    {
        $row = $this->draft($key) ?? $this->live($key);

        return $row !== null ? $row->payload : $this->schemas->for($key)->initial();
    }

    /**
     * @param  array<array-key, mixed>  $payload
     * @param  int|null  $revision  the draft's revision the editor loaded; null when it started without a draft
     *
     * @throws AuthorizationException|ValidationException|ConfigRefused
     */
    public function saveDraft(Staff $staff, ConfigKey $key, array $payload, ?int $revision): ConfigVersion
    {
        $this->ensure($staff, $key, $key->editAtom());
        $normalized = $this->schemas->for($key)->normalize($payload);

        try {
            return $this->writeDraft($staff, $key, $normalized, $revision);
        } catch (UniqueConstraintViolationException) {
            // SF-8: two first drafts of a key at once. Both saw no row, so no row lock kept them apart; the unique (key, version) index
            // let one in. The other one hears what it would have heard a moment later: someone else's draft holds the key.
            throw new ConfigRefused('draft_taken', ['staff' => $this->draft($key)?->creator?->getAttribute('name')]);
        } catch (QueryException|DeadlockException $failure) {
            // The same race as a deadlock or a lock wait between the two inserts (InnoDB gap locks on the empty key): never a 500.
            // Inside an outer transaction Laravel rethrows a deadlock as a DeadlockException (no retry at that level).
            if ($failure instanceof DeadlockException || $this->causedByConcurrencyError($failure)) {
                throw new ConfigRefused('draft_taken', ['staff' => null]);
            }

            throw $failure;
        }
    }

    /**
     * @param  array<string, mixed>  $normalized
     */
    private function writeDraft(Staff $staff, ConfigKey $key, array $normalized, ?int $revision): ConfigVersion
    {
        return DB::transaction(function () use ($staff, $key, $normalized, $revision): ConfigVersion {
            $rows = $this->lock($key);
            $draft = $rows->first(fn (ConfigVersion $row): bool => $row->status === ConfigVersionStatus::Draft);
            $live = $rows->first(fn (ConfigVersion $row): bool => $row->status === ConfigVersionStatus::Published);

            if ($draft !== null) {
                if ($draft->created_by !== $staff->getKey()) {
                    throw new ConfigRefused('draft_taken', ['staff' => $draft->creator?->getAttribute('name')]);
                }

                if ($revision !== $draft->revision) {
                    throw new ConfigRefused('stale_revision', ['revision' => $draft->revision]);
                }

                $previous = $draft->payload;
                $draft->forceFill(['payload' => $normalized, 'revision' => $draft->revision + 1])->save();
            } else {
                if ($revision !== null) {
                    throw new ConfigRefused('stale_revision', ['revision' => null]);
                }

                $previous = $live !== null ? $live->payload : [];
                $draft = ConfigVersion::query()->create([
                    'key' => $key->value,
                    'version' => $this->nextVersion($rows),
                    'status' => ConfigVersionStatus::Draft,
                    'revision' => 1,
                    'base_version' => $live?->version,
                    'payload' => $normalized,
                    'created_by' => $staff->getKey(),
                ]);
            }

            $diff = JsonDiff::between($previous, $normalized);
            Audit::record(ContentEvent::ConfigDraftSaved->value, $draft,
                before: ['changes' => $diff['before']],
                after: ['key' => $key->value, 'version' => $draft->version, 'revision' => $draft->revision, 'changes' => $diff['after']],
                actor: $staff);

            return $draft;
        });
    }

    /**
     * The creator discards their draft; someone holding the key's publish atom may discard another's (with a reason).
     *
     * @throws AuthorizationException|ValidationException|ConfigRefused
     */
    public function discardDraft(Staff $staff, ConfigKey $key, ?string $reason = null): void
    {
        $this->ensure($staff, $key, $key->editAtom());

        DB::transaction(function () use ($staff, $key, $reason): void {
            $draft = $this->lock($key)->first(fn (ConfigVersion $row): bool => $row->status === ConfigVersionStatus::Draft);

            if ($draft === null) {
                throw new ConfigRefused('no_draft');
            }

            if ($draft->created_by !== $staff->getKey()) {
                $this->ensure($staff, $key, $key->publishAtom());
                $reason = Reason::required($reason);
            }

            $draft->delete();

            Audit::record(ContentEvent::ConfigDraftDiscarded->value, $draft,
                before: ['key' => $key->value, 'version' => $draft->version, 'revision' => $draft->revision, 'created_by' => $draft->created_by],
                reason: $reason, actor: $staff);
        });
    }

    /**
     * The four-eyes action publishing the current draft (or $payload) would need, else null.
     *
     * @param  array<array-key, mixed>|null  $payload
     */
    public function approvalFor(ConfigKey $key, ?array $payload = null): ?string
    {
        $payload ??= $this->draft($key)?->payload;

        return $payload === null ? null : $this->schemas->for($key)->approvalFor($this->live($key)->payload ?? [], $payload);
    }

    /**
     * @throws AuthorizationException|ValidationException|ConfigRefused
     */
    public function publish(Staff $staff, ConfigKey $key, string $reason, int $revision): ConfigVersion
    {
        $this->ensure($staff, $key, $key->publishAtom());

        return $this->runPublish($staff, null, $key, Reason::required($reason), $revision, null);
    }

    /**
     * The approved publish: only from the four-eyes handler while Approvals::approve() executes that request (FourEyes), for exactly the
     * draft and revision it names. Payload {key, mode: publish, draft_id, revision}.
     *
     * @throws AuthorizationException|ValidationException|ConfigRefused
     */
    public function publishApproved(ApprovalRequest $request, Staff $requester, Staff $approver): ConfigVersion
    {
        [$key, $action] = $this->approved($request, $requester, $approver, 'publish');

        return $this->runPublish($requester, $approver, $key, $request->reason, (int) $request->payload['revision'], [$action, (int) $request->payload['draft_id']]);
    }

    /**
     * @throws AuthorizationException|ValidationException|ConfigRefused
     */
    public function rollback(Staff $staff, ConfigKey $key, int $version, string $reason): ConfigVersion
    {
        $this->ensure($staff, $key, $key->publishAtom());

        return $this->runRollback($staff, null, $key, $version, Reason::required($reason), null);
    }

    /**
     * The approved rollback, as publishApproved(). Payload {key, mode: rollback, version}.
     *
     * @throws AuthorizationException|ValidationException|ConfigRefused
     */
    public function rollbackApproved(ApprovalRequest $request, Staff $requester, Staff $approver): ConfigVersion
    {
        [$key, $action] = $this->approved($request, $requester, $approver, 'rollback');

        return $this->runRollback($requester, $approver, $key, (int) $request->payload['version'], $request->reason, $action);
    }

    /**
     * The rollback reason as stored on the new version.
     */
    public static function rollbackReason(int $version, string $reason): string
    {
        return mb_substr("Rollback auf v$version: $reason", 0, 1000);
    }

    /**
     * @param  array{0: string, 1: int}|null  $approved  the approval action and the draft id it names
     */
    private function runPublish(Staff $requester, ?Staff $approver, ConfigKey $key, string $reason, int $revision, ?array $approved): ConfigVersion
    {
        $schema = $this->schemas->for($key);

        return DB::transaction(function () use ($requester, $approver, $key, $reason, $revision, $approved, $schema): ConfigVersion {
            $rows = $this->lock($key);
            $draft = $rows->first(fn (ConfigVersion $row): bool => $row->status === ConfigVersionStatus::Draft);
            $live = $rows->first(fn (ConfigVersion $row): bool => $row->status === ConfigVersionStatus::Published);

            if ($draft === null) {
                throw new ConfigRefused('no_draft');
            }

            if ($draft->revision !== $revision || ($approved !== null && $draft->getKey() !== $approved[1])) {
                throw new ConfigRefused('stale_revision', ['revision' => $draft->revision]);
            }

            if ($draft->created_by !== $requester->getKey()) {
                throw new ConfigRefused('draft_taken', ['staff' => $draft->creator?->getAttribute('name')]);
            }

            // The world may have changed since the draft was saved (a build went private, an asset's slot changed).
            $payload = $schema->normalize($draft->payload);
            $before = $live !== null ? $live->payload : [];
            $this->ensureApproval($schema->approvalFor($before, $payload), $approved[0] ?? null);

            return $this->goLive($rows, $draft, $live, $key, $payload, $reason, $requester, $approver, ContentEvent::ConfigPublished);
        });
    }

    private function runRollback(Staff $requester, ?Staff $approver, ConfigKey $key, int $version, string $reason, ?string $approved): ConfigVersion
    {
        $schema = $this->schemas->for($key);

        return DB::transaction(function () use ($requester, $approver, $key, $version, $reason, $approved, $schema): ConfigVersion {
            $rows = $this->lock($key);
            $target = $rows->first(fn (ConfigVersion $row): bool => $row->version === $version && $row->status !== ConfigVersionStatus::Draft);
            $live = $rows->first(fn (ConfigVersion $row): bool => $row->status === ConfigVersionStatus::Published);

            if ($target === null) {
                throw new ConfigRefused('version_missing', ['version' => $version]);
            }

            if ($live !== null && $target->is($live)) {
                throw new ConfigRefused('already_live', ['version' => $version]);
            }

            $before = $live !== null ? $live->payload : [];
            $this->ensureApproval($schema->approvalFor($before, $target->payload), $approved);

            $copy = new ConfigVersion([
                'key' => $key->value,
                'version' => $this->nextVersion($rows),
                'status' => ConfigVersionStatus::Draft,
                'revision' => 1,
                'base_version' => $live?->version,
                'payload' => $target->payload,
                'created_by' => $requester->getKey(),
            ]);

            return $this->goLive($rows, $copy, $live, $key, $target->payload, self::rollbackReason($version, $reason), $requester, $approver, ContentEvent::ConfigRolledBack, $version);
        });
    }

    /**
     * @param  Collection<int, ConfigVersion>  $rows
     * @param  array<string, mixed>  $payload
     */
    private function goLive(Collection $rows, ConfigVersion $next, ?ConfigVersion $live, ConfigKey $key, array $payload, string $reason, Staff $requester, ?Staff $approver, ContentEvent $event, ?int $rolledBackTo = null): ConfigVersion
    {
        $before = $live !== null ? $live->payload : [];
        $diff = JsonDiff::between($before, $payload);

        if ($diff['after'] === [] && $live !== null) {
            throw new ConfigRefused('unchanged');
        }

        $live?->forceFill(['status' => ConfigVersionStatus::Superseded])->save();

        // A draft keeps the number it was created with until now; a rollback since then may have used higher ones.
        $next->forceFill([
            'version' => max((int) $next->getAttribute('version'), $this->nextVersion($rows->reject(fn (ConfigVersion $row): bool => $next->exists && $row->is($next)))),
            'status' => ConfigVersionStatus::Published,
            'payload' => $payload,
            'published_by' => ($approver ?? $requester)->getKey(),
            'published_at' => now(),
            'reason' => $reason,
        ])->save();

        $this->schemas->for($key)->published($payload);

        DB::afterCommit(function (): void {
            $this->appConfig->flush();
            $this->curation->forget();
        });

        Audit::record($event->value, $next,
            before: ['key' => $key->value, 'version' => $live?->version, 'changes' => $diff['before']],
            after: [
                'key' => $key->value,
                'version' => $next->version,
                'rolled_back_to' => $rolledBackTo,
                'changes' => $diff['after'],
                'requested_by' => $requester->getKey(),
                'approved_by' => $approver?->getKey(),
            ],
            reason: $reason, actor: $approver ?? $requester);

        return $next;
    }

    /**
     * @throws ConfigRefused
     */
    private function ensureApproval(?string $needed, ?string $approved): void
    {
        if ($needed !== null && $needed !== $approved) {
            throw new ConfigRefused('approval_required', ['action' => $needed]);
        }
    }

    /**
     * @return array{0: ConfigKey, 1: string}
     *
     * @throws AuthorizationException
     */
    private function approved(ApprovalRequest $request, Staff $requester, Staff $approver, string $mode): array
    {
        $key = ConfigKey::tryFrom((string) ($request->payload['key'] ?? ''));

        if ($key === null || ($request->payload['mode'] ?? null) !== $mode) {
            throw new AuthorizationException('The approval names another change.');
        }

        $atoms = $request->action === 'maintenance.enable' ? [$key->publishAtom(), 'maintenance.toggle'] : [$key->publishAtom()];
        FourEyes::executor([$request->action], $requester, $approver, ...$atoms);

        return [$key, $request->action];
    }

    /**
     * Every row of the key, locked: one writer per key at a time.
     *
     * @return Collection<int, ConfigVersion>
     */
    private function lock(ConfigKey $key): Collection
    {
        return ConfigVersion::query()->where('key', $key->value)->orderBy('version')->lockForUpdate()->get();
    }

    /**
     * @param  Collection<int, ConfigVersion>  $rows
     */
    private function nextVersion(Collection $rows): int
    {
        return ((int) $rows->max('version')) + 1;
    }

    /**
     * @throws AuthorizationException
     */
    private function ensure(Staff $staff, ConfigKey $key, string $atom): void
    {
        StaffAtoms::ensure($staff, $atom);

        if ($key->ownerOnly() && ! $staff->hasRole('owner')) {
            throw new AuthorizationException;
        }
    }
}
