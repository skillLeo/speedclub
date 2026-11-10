<?php

namespace App\Http\Controllers\Admin\Config\Support;

use App\Enums\ApprovalStatus;
use App\Enums\ConfigKey;
use App\Models\ApprovalRequest;
use App\Models\ConfigVersion;
use App\Models\Staff;
use App\Services\Config\ConfigVersions;

/**
 * The props every draft → preview → publish editor of M3.5 reads (06 §1.5; ADM-28, 29, 30, 37): the payload the form starts from (the
 * draft, else the live version, else the schema's first payload), the draft (whose it is, its revision for the optimistic check), the
 * live version, a pending four-eyes request for the draft, whether publishing it would need one, and what this staff member may do.
 */
final class ConfigEditor
{
    /** The keys an M3.5 page edits (ADM-35 lists their history). */
    public const KEYS = [ConfigKey::Branding, ConfigKey::HomeCuration, ConfigKey::Announcements, ConfigKey::RemoteConfig];

    public function __construct(private readonly ConfigVersions $versions) {}

    /**
     * @return array{payload: array<string, mixed>, draft: array<string, mixed>|null, live: array<string, mixed>|null, approval: array<string, mixed>|null, needsApproval: string|null, can: array{edit: bool, publish: bool}}
     */
    public function props(ConfigKey $key, Staff $staff): array
    {
        $draft = $this->versions->draft($key)?->loadMissing('creator:id,name');
        $live = $this->versions->live($key)?->loadMissing('publisher:id,name');
        $pending = $draft === null ? null : ApprovalRequest::query()
            ->where('subject_type', $draft->getMorphClass())->where('subject_id', (string) $draft->getKey())
            ->where('status', ApprovalStatus::Pending)->latest()->first();

        return [
            'payload' => $this->versions->startingPayload($key),
            'draft' => $draft === null ? null : [
                'id' => $draft->id,
                'version' => $draft->version,
                'revision' => $draft->revision,
                'updated_at' => $draft->updated_at?->toIso8601String(),
                'author' => $draft->creator?->getAttribute('name'),
                'mine' => $draft->created_by === $staff->getKey(),
            ],
            'live' => $live === null ? null : self::version($live, $staff),
            'approval' => $pending === null ? null : [
                'id' => $pending->id,
                'title' => $pending->summary['title'] ?? null,
                'expires_at' => $pending->expires_at->toIso8601String(),
            ],
            'needsApproval' => $draft === null ? null : $this->versions->approvalFor($key),
            'can' => [
                'edit' => $staff->can($key->editAtom()),
                'publish' => $staff->can($key->publishAtom()),
            ],
        ];
    }

    /**
     * A published or superseded version for a page (the reason for those who may publish the key).
     *
     * @return array{version: int, status: string, published_at: string|null, published_by: string|null, reason: string|null}
     */
    public static function version(ConfigVersion $version, Staff $staff): array
    {
        return [
            'version' => $version->version,
            'status' => $version->status->value,
            'published_at' => $version->published_at?->toIso8601String(),
            'published_by' => $version->publisher?->getAttribute('name'),
            // Whoever may open the page may publish or roll back this key, and the reason is what they need to decide.
            'reason' => $staff->can(ConfigKey::from($version->key)->publishAtom()) ? $version->reason : null,
        ];
    }
}
