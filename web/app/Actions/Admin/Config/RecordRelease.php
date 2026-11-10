<?php

namespace App\Actions\Admin\Config;

use App\Enums\ContentEvent;
use App\Enums\ReleaseChannel;
use App\Enums\ReleasePlatform;
use App\Enums\ReleaseSource;
use App\Models\Release;
use App\Models\Staff;
use App\Services\Admin\Members\StaffAtoms;
use App\Services\Audit\Audit;
use App\Services\Config\ConfigRefused;
use Illuminate\Auth\Access\AuthorizationException;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Validator;
use Illuminate\Validation\Rule;
use Illuminate\Validation\ValidationException;

/**
 * ADM-38 (`releases.manage`): a manual entry of the release register, or a correction of one (update()). Unique by version name, code,
 * channel and platform (release_taken). Audited as `release.recorded` / `release.updated`.
 */
final class RecordRelease
{
    /**
     * @param  array<string, mixed>  $input  version_name, version_code, platform, channel, apk_sha256?, notes?, released_at?
     *
     * @throws AuthorizationException|ValidationException|ConfigRefused
     */
    public function handle(Staff $staff, array $input): Release
    {
        StaffAtoms::ensure($staff, 'releases.manage');
        $data = $this->validate($input);

        return DB::transaction(function () use ($staff, $data): Release {
            $this->ensureFree($data);
            $release = Release::query()->create([...$data, 'source' => ReleaseSource::Manual, 'created_by' => $staff->getKey()]);

            Audit::record(ContentEvent::ReleaseRecorded->value, $release, after: self::describe($release), actor: $staff);

            return $release;
        });
    }

    /**
     * @param  array<string, mixed>  $input
     *
     * @throws AuthorizationException|ValidationException|ConfigRefused
     */
    public function revise(Staff $staff, Release $release, array $input, ?string $reason = null): Release
    {
        StaffAtoms::ensure($staff, 'releases.manage');
        $data = $this->validate([...self::describe($release), ...$input]);

        return DB::transaction(function () use ($staff, $release, $data, $reason): Release {
            $before = self::describe($release);
            $this->ensureFree($data, $release->id);
            $release->fill($data)->save();

            Audit::record(ContentEvent::ReleaseUpdated->value, $release, before: $before, after: self::describe($release), reason: $reason, actor: $staff);

            return $release;
        });
    }

    /**
     * @return array<string, mixed>
     */
    public static function describe(Release $release): array
    {
        return [
            'version_name' => $release->version_name,
            'version_code' => $release->version_code,
            'platform' => $release->platform->value,
            'channel' => $release->channel->value,
            'apk_sha256' => $release->apk_sha256,
            'notes' => $release->notes,
            'released_at' => $release->released_at?->toIso8601ZuluString(),
        ];
    }

    /**
     * @param  array<string, mixed>  $input
     * @return array<string, mixed>
     *
     * @throws ValidationException
     */
    private function validate(array $input): array
    {
        $data = Validator::make($input, [
            'version_name' => ['required', 'string', 'max:32', 'regex:/\A\d+\.\d+\.\d+([.-][0-9A-Za-z.-]+)?\z/'],
            'version_code' => ['required', 'integer', 'between:1,2100000000'],
            'platform' => ['required', Rule::enum(ReleasePlatform::class)],
            'channel' => ['required', Rule::enum(ReleaseChannel::class)],
            'apk_sha256' => ['nullable', 'string', 'regex:/\A[0-9A-Fa-f]{64}\z/'],
            'notes' => ['nullable', 'string', 'max:5000'],
            'released_at' => ['nullable', 'date'],
        ])->validate();

        if (is_string($data['apk_sha256'] ?? null)) {
            $data['apk_sha256'] = strtoupper($data['apk_sha256']);
        }

        return $data;
    }

    /**
     * @param  array<string, mixed>  $data
     *
     * @throws ConfigRefused
     */
    private function ensureFree(array $data, ?int $except = null): void
    {
        $taken = Release::query()
            ->where('version_name', $data['version_name'])->where('version_code', $data['version_code'])
            ->where('channel', $data['channel'])->where('platform', $data['platform'])
            ->when($except !== null, fn ($query) => $query->whereKeyNot($except))
            ->lockForUpdate()->exists();

        if ($taken) {
            throw new ConfigRefused('release_taken');
        }
    }
}
