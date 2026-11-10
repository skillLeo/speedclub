<?php

namespace App\Actions\Garage;

use App\Actions\Media\DeleteAllMedia;
use App\Enums\QrRevocationReason;
use App\Enums\VehicleStatus;
use App\Enums\Visibility;
use App\Models\User;
use App\Models\Vehicle;
use App\Services\PublicPages\OgImages;
use App\Services\PublicPages\SitemapWriter;
use App\Services\Qr\QrCodes;
use App\Services\Search\VehicleSearchProjector;
use Illuminate\Support\Facades\DB;

/**
 * 02_PRODUCT_SPEC §3.2: soft delete, QR revoked, out of search at once, public photo files gone (ADR-123). `vehicles:prune` hard
 * deletes after 30 days. A main vehicle hands over to the next published one, public ones first.
 */
class DeleteVehicle
{
    /** A backstop against a deadlock with what does not take the member's lock first. The closure starts with a fresh read, and a rollback undoes all it wrote. */
    private const ATTEMPTS = 3;

    public function __construct(
        private readonly QrCodes $qr,
        private readonly VehicleSearchProjector $search,
        private readonly DeleteAllMedia $media,
        private readonly OgImages $og,
        private readonly SitemapWriter $sitemap,
    ) {}

    public function handle(User $user, Vehicle $vehicle): void
    {
        DB::transaction(function () use ($user, $vehicle): void {
            User::query()->whereKey($user->id)->lockForUpdate()->value('id');
            // What the route read is older than this lock: it may have become main since, or be gone already.
            $vehicle->refresh();

            if ($vehicle->trashed()) {
                return;
            }

            $wasMain = $vehicle->is_main;

            $vehicle->forceFill(['is_main' => false])->save();
            $vehicle->delete();

            $this->qr->revoke($vehicle, QrRevocationReason::VehicleDeleted);
            $this->search->remove($vehicle->id);

            if ($wasMain) {
                $this->promoteNext($user);
            }
        }, self::ATTEMPTS);

        // After the commit (the outermost one, when a staff deletion wraps this with its decision, SF-7): a rollback can bring rows
        // back, but not files.
        DB::afterCommit(function () use ($vehicle): void {
            $this->media->forVehicle($vehicle);
            $this->og->purge($vehicle);
            $this->sitemap->forget();
        });
    }

    /**
     * Housekeeping, as in SetMainVehicle: the next vehicle takes the title without counting as changed.
     */
    private function promoteNext(User $user): void
    {
        $next = $user->vehicles()
            ->where('status', VehicleStatus::Published)
            ->orderByRaw('visibility = ? desc', [Visibility::Public->value])
            ->orderBy('sort')
            ->orderBy('id')
            ->value('id');

        if ($next !== null) {
            Vehicle::query()->whereKey($next)->toBase()->update(['is_main' => true]);
        }
    }
}
