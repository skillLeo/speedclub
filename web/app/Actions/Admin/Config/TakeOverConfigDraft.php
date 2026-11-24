<?php

namespace App\Actions\Admin\Config;

use App\Enums\ConfigKey;
use App\Enums\StaffAlertKind;
use App\Models\ConfigVersion;
use App\Models\Staff;
use App\Services\Config\ConfigRefused;
use App\Services\Config\ConfigVersions;
use App\Services\Team\StaffAlerts;
use Illuminate\Auth\Access\AuthorizationException;
use Illuminate\Support\Facades\DB;
use Illuminate\Validation\ValidationException;

/**
 * "Entwurf übernehmen" ⚿ (M5.1): a staff member with the key's publish atom takes over another staff member's draft with a reason, so
 * it can be edited and published (before, the only way past someone else's draft was to discard it). Audited `config.draft_taken_over`.
 * SEC-P5-07: the former author gets DraftTakenOverMail (who, which area, the reason; StaffAlerts, queued with retries after the commit).
 */
final class TakeOverConfigDraft
{
    public function __construct(private readonly ConfigVersions $versions, private readonly StaffAlerts $alerts) {}

    /**
     * @throws AuthorizationException|ValidationException|ConfigRefused
     */
    public function handle(Staff $staff, ConfigKey $key, string $reason, int $revision): ConfigVersion
    {
        return DB::transaction(function () use ($staff, $key, $reason, $revision): ConfigVersion {
            $before = $this->versions->draft($key)?->created_by;
            $draft = $this->versions->takeOverDraft($staff, $key, $reason, $revision);
            $author = $before === null || $before === $staff->getKey() ? null : Staff::query()->find($before);

            if ($author !== null && $draft->created_by === $staff->getKey()) {
                $this->alerts->queue(StaffAlertKind::DraftTakenOver, ((string) $draft->getKey()).':'.$draft->revision, [$author], [
                    'actor' => (string) $staff->name,
                    'key' => $key->value,
                    'reason' => trim($reason),
                    'at' => now()->timezone((string) config('speedclub.notifications.timezone', 'Europe/Berlin'))->format('d.m.Y H:i'),
                ]);
            }

            return $draft;
        });
    }
}
