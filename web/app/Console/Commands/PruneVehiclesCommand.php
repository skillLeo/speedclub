<?php

namespace App\Console\Commands;

use App\Actions\Media\DeleteAllMedia;
use App\Enums\QrRevocationReason;
use App\Models\Vehicle;
use App\Services\Privacy\RetentionPolicy;
use App\Services\Qr\QrCodes;
use Illuminate\Console\Attributes\Description;
use Illuminate\Console\Attributes\Signature;
use Illuminate\Console\Command;
use Illuminate\Support\Facades\DB;
use Throwable;

#[Signature('vehicles:prune')]
#[Description('Hard-delete vehicles past the soft-delete grace period')]
class PruneVehiclesCommand extends Command
{
    /** Keeps one cron run well below the 50 s window; the rest waits for the next day. */
    private const BATCH = 200;

    /**
     * Specs, modifications, updates and the projection go with the foreign keys. The QR codes stay as tombstones without a vehicle
     * (QrResolver), revoked here in case the vehicle went without DeleteVehicle. The photos are media:prune's, which removes them
     * after the same 30 days. Any that a dead request left public are taken back first, whatever the order of the two commands: after
     * this delete the modifications are gone, and nothing could reach their photos any more.
     *
     * A vehicle that fails is reported and stays for the next run, because its photos could not be taken back. The others still go.
     */
    public function handle(QrCodes $codes, DeleteAllMedia $media): int
    {
        $vehicles = Vehicle::onlyTrashed()
            ->where('deleted_at', '<', now()->subDays(app(RetentionPolicy::class)->value('deleted_vehicles_days')))
            ->limit(self::BATCH)
            ->get();

        $deleted = 0;

        foreach ($vehicles as $vehicle) {
            try {
                $media->forVehicle($vehicle);

                DB::transaction(function () use ($codes, $vehicle): void {
                    $codes->revoke($vehicle, QrRevocationReason::VehicleDeleted);
                    $vehicle->forceDelete();
                });

                $deleted++;
            } catch (Throwable $exception) {
                report($exception);
            }
        }

        $this->info("Hard-deleted {$deleted} vehicles.");

        return self::SUCCESS;
    }
}
