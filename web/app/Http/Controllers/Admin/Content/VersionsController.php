<?php

namespace App\Http\Controllers\Admin\Content;

use App\Enums\ConfigKey;
use App\Http\Controllers\Admin\Config\Support\ConfigEditor;
use App\Http\Controllers\Controller;
use App\Models\ConfigVersion;
use App\Models\Staff;
use App\Services\Brand\AccentSets;
use App\Services\Config\ConfigVersions;
use Illuminate\Http\Request;
use Inertia\Inertia;
use Inertia\Response;

/**
 * ADM-35 Versionsverlauf (06 §1.5/§3): per config key the published and superseded versions with who, when and why; the chosen
 * version's payload against the one before it (DiffViewer); "Zurückrollen" ⚿ publishes a copy as the newest version
 * (ConfigDraftController::rollback). Only the keys this staff member may open are listed.
 */
class VersionsController extends Controller
{
    public function __invoke(Request $request, ConfigVersions $versions, AccentSets $accents): Response
    {
        /** @var Staff $staff */
        $staff = $request->user('staff');
        // Every versioned key this staff member may open (rate limits, retention and org settings too); rollback only where its page
        // edits through the draft model (ConfigEditor::KEYS), the others change on their own page.
        $keys = array_values(array_filter(ConfigKey::cases(), fn (ConfigKey $key): bool => $staff->can(self::viewAtom($key))));
        $key = ConfigKey::tryFrom((string) $request->query('key'));
        $key = $key !== null && in_array($key, $keys, true) ? $key : ($keys[0] ?? null);
        abort_if($key === null, 403);

        $history = $versions->history($key)->loadMissing('publisher:id,name');
        $chosen = $history->firstWhere('version', (int) $request->query('version')) ?? $history->first();
        $previous = $chosen === null ? null : $history->first(fn (ConfigVersion $row): bool => $row->version < $chosen->version);
        $draft = $versions->draft($key)?->loadMissing('creator:id,name');

        return Inertia::render('Content/Versions', [
            'keys' => array_map(fn (ConfigKey $k): string => $k->value, $keys),
            'configKey' => $key->value,
            'versions' => array_values($history->map(fn (ConfigVersion $row): array => ConfigEditor::version($row, $staff))->all()),
            'chosen' => $chosen === null ? null : [
                ...ConfigEditor::version($chosen, $staff),
                'payload' => $chosen->payload,
                'needs_approval' => $chosen->status->value === 'published' ? null : $versions->approvalFor($key, $chosen->payload),
                'previous' => $previous === null ? null : ['version' => $previous->version, 'payload' => $previous->payload],
            ],
            'draft' => $draft === null ? null : ['version' => $draft->version, 'author' => $draft->creator?->getAttribute('name'), 'updated_at' => $draft->updated_at?->toIso8601String()],
            // The set the alias `default` of the first install stands for: the diff reads both as that set (DQ-668).
            'accentDefault' => $key === ConfigKey::Branding ? $accents->defaultKey() : null,
            'canRollback' => in_array($key, ConfigEditor::KEYS, true) && $staff->can($key->publishAtom()),
            'editRoute' => match ($key) {
                ConfigKey::Branding => 'admin.brand.index',
                ConfigKey::HomeCuration => 'admin.content.home',
                ConfigKey::Announcements => 'admin.content.announcements',
                ConfigKey::RateLimits => 'admin.moderation.rules',
                ConfigKey::Retention => 'admin.privacy.retention',
                ConfigKey::Org => 'admin.settings',
                ConfigKey::RemoteConfig => 'admin.config.remote',
            },
        ]);
    }

    /** Who may see a key's history: whoever may open its page. */
    public static function viewAtom(ConfigKey $key): string
    {
        return match ($key) {
            ConfigKey::Branding => 'brand.manage',
            ConfigKey::RemoteConfig => 'remote_config.manage',
            ConfigKey::HomeCuration, ConfigKey::Announcements => 'content.view',
            default => $key->editAtom(),
        };
    }
}
