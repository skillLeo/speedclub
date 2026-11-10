<?php

namespace App\Actions\Admin\Privacy;

use App\Enums\ConfigKey;
use App\Models\ConfigVersion;
use App\Models\Staff;
use App\Services\Admin\Members\StaffAtoms;
use App\Services\Catalog\Reason;
use App\Services\Config\ConfigRefused;
use App\Services\Config\ConfigVersions;
use Illuminate\Auth\Access\AuthorizationException;
use Illuminate\Support\Facades\DB;
use Illuminate\Validation\ValidationException;

/**
 * ADM-47 "Speichern" (`retention.manage`, with reason; the route also asks for a recent password, ADR-215): the periods are drafted and
 * published in one step through the config engine (ConfigVersions: RetentionSchema checks the bounds; `config.published` carries the
 * diff and the reason). Rollback works as for every config key (ADM-35).
 *
 * @throws AuthorizationException|ValidationException|ConfigRefused
 */
class UpdateRetention
{
    public function __construct(private readonly ConfigVersions $versions) {}

    /**
     * @param  array<array-key, mixed>  $periods  key => whole number (null: the default)
     */
    public function handle(Staff $by, array $periods, string $reason): ConfigVersion
    {
        StaffAtoms::ensure($by, 'retention.manage');
        $reason = Reason::required($reason);

        return DB::transaction(function () use ($by, $periods, $reason): ConfigVersion {
            $draft = $this->versions->draft(ConfigKey::Retention);
            $revision = $draft !== null && $draft->created_by === $by->getKey() ? $draft->revision : null;
            $saved = $this->versions->saveDraft($by, ConfigKey::Retention, ['periods' => $periods], $revision);

            return $this->versions->publish($by, ConfigKey::Retention, $reason, $saved->revision);
        });
    }
}
