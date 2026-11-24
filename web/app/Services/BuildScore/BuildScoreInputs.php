<?php

namespace App\Services\BuildScore;

use App\Enums\BuildUpdateType;
use App\Enums\LegalStatus;
use App\Enums\MediaStatus;
use App\Enums\ModerationStatus;
use App\Enums\ModStatus;
use App\Models\BuildUpdate;
use App\Models\Media;
use App\Models\Modification;
use App\Models\Vehicle;
use Carbon\CarbonImmutable;
use Illuminate\Database\Eloquent\Collection;
use Illuminate\Database\Query\Builder;
use Illuminate\Support\Facades\DB;

/**
 * Gathers BuildScoreFacts for one vehicle from the database (m5.9c contract §3). What never counts: samples (a sample member's reaction,
 * spot or follow counts only for a sample car), hidden or deleted content, rejected or unfinished photos, deleted members, the owner
 * and members blocked by or blocking the owner. Each member counts once per car and kind. Values of power, torque, cost or speed are
 * never read: a key spec counts when it is filled.
 */
final class BuildScoreInputs
{
    /**
     * The ten key specs of the Daten section (VehiclePresenter::specGroups): make, model and model year are left out, as publishing
     * requires them anyway; engine counts once for its text or its code.
     */
    public const KEY_SPECS = ['generation', 'color', 'engine', 'displacement', 'fuel', 'aspiration', 'power', 'torque', 'drivetrain', 'gearbox'];

    /** Mods the owner states as entered in the vehicle papers ("TÜV-eingetragen", contract §1). */
    public const REGISTERED = [LegalStatus::Registered, LegalStatus::IndividualApproval];

    public function for(Vehicle $vehicle): BuildScoreFacts
    {
        $mods = $this->mods($vehicle);
        $updates = BuildUpdate::query()
            ->where('vehicle_id', $vehicle->id)
            ->where('hidden', false)
            ->whereIn('type', array_map(fn (BuildUpdateType $type): string => $type->value, array_filter(BuildUpdateType::cases(), fn (BuildUpdateType $type): bool => $type->isAuthored())))
            ->get(['id', 'happened_on', 'created_at', 'photo_pairs']);

        $dates = [];

        foreach ($updates as $update) {
            $day = $update->happened_on ?? $update->getAttribute('created_at');

            if ($day !== null) {
                $dates[] = CarbonImmutable::parse($day)->startOfDay();
            }
        }

        foreach ($mods['dates'] as $day) {
            $dates[] = $day;
        }

        return new BuildScoreFacts(
            photos: Media::query()->where('mediable_type', $vehicle->getMorphClass())->where('mediable_id', $vehicle->id)->usablePhoto()->count(),
            keySpecs: $this->keySpecs($vehicle),
            descriptionChars: mb_strlen(trim((string) $vehicle->getAttribute('description'))),
            coverFocal: $this->coverFocal($vehicle),
            documentedMods: $mods['documented'],
            undocumentedMods: $mods['undocumented'],
            registeredMods: $mods['registered'],
            existingMods: $mods['existing'],
            plannedMods: $mods['planned'],
            reactors: $this->reactors($vehicle),
            spotters: $this->actors($vehicle, DB::table('spots')->where('spots.vehicle_id', $vehicle->id)->where('spots.counted', true)->whereNull('spots.deleted_at'), 'spots.spotter_id'),
            followers: $this->actors($vehicle, DB::table('vehicle_follows')->where('vehicle_follows.vehicle_id', $vehicle->id), 'vehicle_follows.user_id'),
            timeline: $updates->count(),
            beforeAfter: $this->pairs($updates->filter(fn (BuildUpdate $update): bool => ($update->photo_pairs ?? []) !== [])->values()->all()),
            historyMonths: $this->months($dates),
        );
    }

    private function keySpecs(Vehicle $vehicle): int
    {
        $specs = $vehicle->specs()->first();
        $filled = fn (string $column): bool => $specs !== null && $specs->getAttribute($column) !== null && $specs->getAttribute($column) !== '';

        return count(array_filter([
            'generation' => $vehicle->getAttribute('generation_id') !== null,
            'color' => trim((string) $vehicle->getAttribute('color')) !== '',
            'engine' => $filled('engine_text') || $filled('engine_code'),
            'displacement' => $filled('displacement_cc'),
            'fuel' => $filled('fuel'),
            'aspiration' => $filled('aspiration'),
            // Whether a figure was entered, never how big it is.
            'power' => $filled('power_value'),
            'torque' => $filled('torque_nm'),
            'drivetrain' => $filled('drivetrain'),
            'gearbox' => $filled('gearbox'),
        ]));
    }

    private function coverFocal(Vehicle $vehicle): bool
    {
        $cover = $vehicle->getAttribute('cover_media_id');

        if ($cover === null) {
            return false;
        }

        return Media::query()->whereKey($cover)
            ->where('mediable_type', $vehicle->getMorphClass())->where('mediable_id', $vehicle->id)
            ->usablePhoto()
            ->whereNotNull('focal_x')->whereNotNull('focal_y')
            ->exists();
    }

    /**
     * M5.9d: the ids of the car's documented mods, by the same rule as the score (isDocumented), so the XP rule "documented mod" and the
     * Build Score always agree.
     *
     * @return list<string>
     */
    public function documentedModIds(Vehicle $vehicle): array
    {
        return array_values($this->modRows($vehicle)
            ->filter(fn (Modification $mod): bool => $mod->getAttribute('status') !== ModStatus::Planned && self::isDocumented($mod))
            ->map(fn (Modification $mod): string => (string) $mod->id)
            ->all());
    }

    /**
     * A documented mod (contract §3): a brand (catalogue or free text), an installation date and at least one usable photo. Reads the
     * `usable_photos` count modRows() adds; planned mods are the caller's to leave out.
     */
    public static function isDocumented(Modification $mod): bool
    {
        $brand = $mod->getAttribute('brand_id') !== null || trim((string) $mod->getAttribute('brand_text')) !== '';

        return $brand && $mod->getAttribute('installed_on') !== null && (int) $mod->getAttribute('usable_photos') > 0;
    }

    /**
     * @return Collection<int, Modification>
     */
    private function modRows(Vehicle $vehicle): Collection
    {
        return Modification::query()
            ->where('vehicle_id', $vehicle->id)
            ->withCount(['media as usable_photos' => fn ($query) => $query->usablePhoto()])
            ->get(['id', 'status', 'brand_id', 'brand_text', 'installed_on', 'legal_status']);
    }

    /**
     * @return array{documented: int, undocumented: int, registered: int, existing: int, planned: int, dates: list<CarbonImmutable>}
     */
    private function mods(Vehicle $vehicle): array
    {
        $mods = $this->modRows($vehicle);
        $result = ['documented' => 0, 'undocumented' => 0, 'registered' => 0, 'existing' => 0, 'planned' => 0, 'dates' => []];

        foreach ($mods as $mod) {
            if ($mod->getAttribute('status') === ModStatus::Planned) {
                $result['planned']++;

                continue;
            }

            $result['existing']++;
            $installed = $mod->getAttribute('installed_on');
            $result[self::isDocumented($mod) ? 'documented' : 'undocumented']++;

            if (in_array($mod->getAttribute('legal_status'), self::REGISTERED, true)) {
                $result['registered']++;
            }

            if ($installed !== null) {
                $result['dates'][] = CarbonImmutable::parse($installed)->startOfDay();
            }
        }

        return $result;
    }

    /**
     * Members who reacted to the car itself or to one of its visible build updates, each once.
     */
    private function reactors(Vehicle $vehicle): int
    {
        $updates = DB::table('build_updates')->where('vehicle_id', $vehicle->id)->where('hidden', false)->select('id');
        $reactions = DB::table('reactions')->where(fn (Builder $query) => $query
            ->where(fn (Builder $own) => $own->where('reactions.reactable_type', $vehicle->getMorphClass())->where('reactions.reactable_id', $vehicle->id))
            ->orWhere(fn (Builder $posts) => $posts->where('reactions.reactable_type', (new BuildUpdate)->getMorphClass())->whereIn('reactions.reactable_id', $updates)));

        return $this->actors($vehicle, $reactions, 'reactions.user_id');
    }

    /**
     * Distinct members of $rows (the qualified member column $column) who count for this car.
     */
    private function actors(Vehicle $vehicle, Builder $rows, string $column): int
    {
        $owner = (string) $vehicle->owner_id;

        return (int) $rows
            ->join('users as actor', 'actor.id', '=', $column)
            ->whereNull('actor.deleted_at')
            ->where('actor.id', '!=', $owner)
            ->when($vehicle->getAttribute('is_sample') !== true, fn (Builder $query) => $query->where('actor.is_sample', false))
            ->whereNotExists(fn (Builder $blocks) => $blocks->selectRaw('1')->from('blocks')
                ->where(fn (Builder $either) => $either
                    ->where(fn (Builder $by) => $by->where('blocks.blocker_id', $owner)->whereColumn('blocks.blocked_id', 'actor.id'))
                    ->orWhere(fn (Builder $of) => $of->where('blocks.blocked_id', $owner)->whereColumn('blocks.blocker_id', 'actor.id'))))
            ->distinct()
            ->count('actor.id');
    }

    /**
     * Pairs whose two photos belong to their update and are usable.
     *
     * @param  array<int, BuildUpdate>  $updates
     */
    private function pairs(array $updates): int
    {
        if ($updates === []) {
            return 0;
        }

        $usable = Media::query()
            ->where('mediable_type', (new BuildUpdate)->getMorphClass())
            ->whereIn('mediable_id', array_map(fn (BuildUpdate $update): string => (string) $update->getKey(), $updates))
            ->where('status', MediaStatus::Ready)
            ->where('moderation_status', '!=', ModerationStatus::Rejected)
            ->get(['id', 'mediable_id'])
            ->mapWithKeys(fn (Media $media): array => [strtolower((string) $media->getKey()) => strtolower((string) $media->getAttribute('mediable_id'))])
            ->all();
        $count = 0;

        foreach ($updates as $update) {
            $id = strtolower((string) $update->getKey());

            foreach ($update->photo_pairs ?? [] as $pair) {
                $before = strtolower($pair[0]);
                $after = strtolower($pair[1]);

                if ($before !== $after && ($usable[$before] ?? null) === $id && ($usable[$after] ?? null) === $id) {
                    $count++;
                }
            }
        }

        return $count;
    }

    /**
     * @param  list<CarbonImmutable>  $dates
     */
    private function months(array $dates): int
    {
        if (count($dates) < 2) {
            return 0;
        }

        usort($dates, fn (CarbonImmutable $a, CarbonImmutable $b): int => $a <=> $b);

        return max(0, (int) floor($dates[0]->diffInMonths(end($dates))));
    }
}
