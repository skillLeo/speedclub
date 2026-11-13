<?php

namespace App\Actions\Social\Updates;

use App\Enums\BuildUpdateAudience;
use App\Enums\BuildUpdateType;
use App\Enums\KeywordField;
use App\Enums\VehicleStatus;
use App\Models\BuildUpdate;
use App\Models\User;
use App\Models\Vehicle;
use App\Services\Notifications\PublicationFanout;
use App\Services\Rules\ContentScreen;
use App\Services\Showcase\SampleContent;
use App\Services\Social\BuildUpdateMentions;
use Carbon\CarbonImmutable;
use Illuminate\Support\Facades\DB;

/**
 * UPD-01 "Update posten" (09 §8.5): text up to 2,000 characters with @mentions, linked mods, mileage, date (default today in Berlin) and
 * audience; the photos follow with UploadBuildUpdatePhoto (up to 10, before/after pairs by EditBuildUpdate). Keyword rules as on a note;
 * followers hear about it through the publication fan-out (members following the owner or the vehicle), mentioned members directly.
 */
class PostBuildUpdate
{
    public function __construct(
        private readonly ContentScreen $screen,
        private readonly PublicationFanout $fanout,
        private readonly BuildUpdateMentions $mentions,
    ) {}

    /**
     * @param  array{text?: string|null, mileage_km?: int|null, happened_on?: string|null, audience?: string|null, modification_ids?: list<string>|null}  $data
     */
    public function handle(User $owner, Vehicle $vehicle, array $data): BuildUpdate
    {
        $text = self::text($data['text'] ?? null);
        $flags = $text === null ? [] : $this->screen->screen(['text' => [KeywordField::BuildNote, $text]]);

        $update = DB::transaction(function () use ($owner, $vehicle, $data, $text): BuildUpdate {
            Vehicle::query()->whereKey($vehicle->id)->lockForUpdate()->firstOrFail();

            $update = new BuildUpdate([
                'type' => BuildUpdateType::Post,
                'note' => $text,
                'mileage_km' => $data['mileage_km'] ?? null,
                'happened_on' => $data['happened_on'] ?? CarbonImmutable::now(config()->string('speedclub.notifications.timezone'))->toDateString(),
                'audience' => BuildUpdateAudience::tryFrom((string) ($data['audience'] ?? '')) ?? BuildUpdateAudience::Vehicle,
            ]);
            $update->forceFill([
                'vehicle_id' => $vehicle->id,
                // 09 §8.19: an update of a sample build is a sample too.
                'is_sample' => SampleContent::isSample($vehicle),
                'created_at' => now(),
            ])->save();

            self::syncMods($update, $data['modification_ids'] ?? []);
            $this->mentions->afterSave($update, $owner, $text);

            return $update;
        });

        $this->screen->flagAfterCommit($flags, $update);

        if ($vehicle->status === VehicleStatus::Published) {
            $this->fanout->updateCreated($update);
        }

        return $update;
    }

    public static function text(?string $text): ?string
    {
        $text = $text === null ? null : trim(str_replace("\r\n", "\n", $text));

        return $text === '' ? null : $text;
    }

    /**
     * The linked mods in the given order; the request already checked they are this vehicle's.
     *
     * @param  list<string>  $ids
     */
    public static function syncMods(BuildUpdate $update, array $ids): void
    {
        $update->modifications()->sync(array_combine($ids, array_map(fn (int $position): array => ['position' => $position], array_keys($ids))) ?: []);
    }
}
