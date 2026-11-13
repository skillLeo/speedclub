<?php

namespace App\Actions\Media;

use App\Models\MaintenanceLog;
use App\Models\Media;
use App\Models\Modification;
use App\Models\Vehicle;
use Illuminate\Database\Eloquent\Builder;
use Illuminate\Database\Eloquent\Collection;
use Throwable;

/**
 * Deleting a vehicle or a modification commits first and withdraws its photos after that, because a rollback can bring rows back but not
 * files. A request that dies in between (a host limit, a storage fault) leaves live photos on something deleted, with public files that
 * still answer, and the member cannot try again. This is what catches them: the daily media:prune, well before the hard delete of
 * vehicles:prune can cut the mods off.
 *
 * It also takes back live photos whose vehicle or modification row is gone altogether, which an older build could leave behind
 * (BH-49 residual): this build withdraws photos before any hard delete.
 *
 * One photo that keeps failing is reported and passed over, so it does not stop the others or the later steps of media:prune day after day.
 */
class SweepDetachedMedia
{
    public function __construct(
        private readonly DeleteAllMedia $vehicles,
        private readonly DeleteMedia $photos,
    ) {}

    /**
     * @param  int  $batch  at most this many vehicles and this many photos of modifications; the rest waits for the next run
     * @return int the photos taken back
     */
    public function handle(int $batch): int
    {
        $count = 0;
        $tried = 0;

        $vehicles = Vehicle::onlyTrashed()
            ->where(fn ($query) => $query
                ->whereHas('media')
                ->orWhereHas('modifications', fn ($mods) => $mods->withTrashed()->whereHas('media'))
                ->orWhereHas('maintenanceLogs', fn ($logs) => $logs->whereHas('media')))
            ->limit($batch)
            ->get();

        foreach ($vehicles as $vehicle) {
            // One vehicle can hold far more than one photo: stay within the cron window, and the rest comes tomorrow.
            if ($tried >= $batch) {
                return $count;
            }

            foreach ($this->vehicles->photosOf($vehicle) as $photo) {
                $tried++;
                $count += $this->takeBack($photo);
            }
        }

        $ofDeletedMods = Media::query()
            ->where('mediable_type', (new Modification)->getMorphClass())
            ->whereIn('mediable_id', Modification::onlyTrashed()->select('id'))
            ->limit($batch)
            ->get();

        foreach ($ofDeletedMods as $photo) {
            $count += $this->takeBack($photo);
        }

        foreach ($this->ofMissingParents($batch) as $photo) {
            $count += $this->takeBack($photo);
        }

        return $count;
    }

    /**
     * Live photos of a vehicle or a modification whose row no longer exists, trashed or not.
     *
     * @return Collection<int, Media>
     */
    private function ofMissingParents(int $batch): Collection
    {
        $missing = fn (string $type, string $table) => fn (Builder $query) => $query
            ->where('mediable_type', $type)
            ->whereNotExists(fn ($parent) => $parent->selectRaw('1')->from($table)->whereColumn($table.'.id', 'media.mediable_id'));

        return Media::query()
            ->where(fn (Builder $query) => $query
                ->where($missing((new Vehicle)->getMorphClass(), (new Vehicle)->getTable()))
                ->orWhere($missing((new Modification)->getMorphClass(), (new Modification)->getTable()))
                ->orWhere($missing((new MaintenanceLog)->getMorphClass(), (new MaintenanceLog)->getTable())))
            ->limit($batch)
            ->get();
    }

    /**
     * @return int<0, 1>
     */
    private function takeBack(Media $photo): int
    {
        try {
            $this->photos->handle($photo);

            return 1;
        } catch (Throwable $exception) {
            report($exception);

            return 0;
        }
    }
}
