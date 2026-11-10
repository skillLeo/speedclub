<?php

namespace App\Services\Approvals\Handlers;

use App\Enums\ConfigKey;
use App\Enums\ConfigVersionStatus;
use App\Models\ApprovalRequest;
use App\Models\ConfigVersion;
use App\Models\Staff;
use App\Services\Approvals\ApprovalHandler;
use App\Services\Approvals\ChecksPayloadAtoms;
use App\Services\Approvals\FourEyes;
use App\Services\Config\ConfigVersions;
use Illuminate\Support\Facades\Validator;
use Illuminate\Validation\Rule;
use Illuminate\Validation\ValidationException;

/**
 * maintenance.enable (ADM-37, 06 §2 "maintenance mode on"): publishing a remote_config draft, or rolling back to a version, that turns
 * maintenance on. Payload {key: remote_config, mode: publish, draft_id, revision} or {key: remote_config, mode: rollback, version}. At
 * approval the draft must still be that revision (or the version must still exist); the engine checks the rest (ConfigVersions).
 * Requester and approver hold maintenance.toggle and remote_config.manage. Turning it off needs no approval.
 */
final class EnableMaintenance implements ApprovalHandler, ChecksPayloadAtoms
{
    public function __construct(private readonly ConfigVersions $versions) {}

    public function key(): string
    {
        return 'maintenance.enable';
    }

    public function atom(): string
    {
        return 'maintenance.toggle';
    }

    public function atomsFor(array $payload): array
    {
        return ['remote_config.manage'];
    }

    public function requiresOwner(array $payload): bool
    {
        return false;
    }

    public function validate(array $payload): void
    {
        Validator::make($payload, [
            'key' => ['required', Rule::in([ConfigKey::RemoteConfig->value])],
            'mode' => ['required', Rule::in(['publish', 'rollback'])],
            'draft_id' => ['required_if:mode,publish', 'integer'],
            'revision' => ['required_if:mode,publish', 'integer'],
            'version' => ['required_if:mode,rollback', 'integer'],
        ])->validate();

        $exists = $payload['mode'] === 'publish'
            ? ConfigVersion::query()->whereKey($payload['draft_id'])->where('key', ConfigKey::RemoteConfig->value)
                ->where('status', ConfigVersionStatus::Draft)->where('revision', $payload['revision'])->exists()
            : ConfigVersion::query()->where('key', ConfigKey::RemoteConfig->value)->where('version', $payload['version'])
                ->where('status', ConfigVersionStatus::Superseded)->exists();

        if (! $exists) {
            throw ValidationException::withMessages(['payload' => [(string) __('content.approvals.changed')]]);
        }
    }

    public function describe(array $payload): array
    {
        $row = ($payload['mode'] ?? null) === 'publish'
            ? ConfigVersion::query()->find((int) ($payload['draft_id'] ?? 0))
            : ConfigVersion::query()->where('key', ConfigKey::RemoteConfig->value)->where('version', $payload['version'] ?? 0)->first();
        $message = $row?->payload['maintenance']['message'] ?? null;

        return [
            'title' => 'approvals.maintenance_enable.title',
            'subject_label' => $row === null ? null : 'v'.$row->version,
            'lines' => [
                ['label' => 'approvals.maintenance_enable.mode', 'after' => (string) ($payload['mode'] ?? '')],
                ['label' => 'approvals.maintenance_enable.maintenance', 'before' => 'off', 'after' => 'on'],
                ['label' => 'approvals.maintenance_enable.message_de', 'after' => is_array($message) && is_string($message['de'] ?? null) ? $message['de'] : null],
                ['label' => 'approvals.maintenance_enable.message_en', 'after' => is_array($message) && is_string($message['en'] ?? null) ? $message['en'] : null],
            ],
        ];
    }

    public function execute(ApprovalRequest $request, Staff $approver): array
    {
        FourEyes::handler($request, $approver, 'maintenance.enable');
        $requester = Staff::query()->findOrFail($request->requested_by);

        $version = $request->payload['mode'] === 'publish'
            ? $this->versions->publishApproved($request, $requester, $approver)
            : $this->versions->rollbackApproved($request, $requester, $approver);

        return ['key' => ConfigKey::RemoteConfig->value, 'version' => $version->version];
    }
}
