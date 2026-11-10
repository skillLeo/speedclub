<?php

namespace App\Actions\Garage;

use App\Enums\ErrorCode;
use App\Enums\VehicleStatus;
use App\Enums\Visibility;
use App\Exceptions\ApiException;
use App\Models\User;
use App\Models\Vehicle;
use App\Services\Notifications\PublicationFanout;
use App\Services\PublicPages\OgImages;
use App\Services\Qr\QrCodes;
use App\Services\Search\VehicleSearchProjector;
use Illuminate\Support\Facades\DB;

/**
 * Publishing requires make, model, model year, one finished photo and a username (02_PRODUCT_SPEC §3.2); the verified address
 * is the verified-member middleware's and the policy's part (ADR-139). The answer names everything missing at once, so the
 * wizard can show the whole list. The member's row lock keeps "first published becomes main" and "at most one main" true.
 */
class PublishVehicle
{
    /** A backstop against a deadlock with what does not take the member's lock first. The closure starts with a fresh read, and a rollback undoes all it wrote. */
    private const ATTEMPTS = 3;

    public function __construct(
        private readonly QrCodes $qr,
        private readonly VehicleSearchProjector $search,
        private readonly OgImages $og,
        private readonly PublicationFanout $fanout,
    ) {}

    public function handle(User $user, Vehicle $vehicle, ?Visibility $visibility = null): Vehicle
    {
        DB::transaction(function () use ($user, $vehicle, $visibility): void {
            $owner = User::query()->whereKey($user->id)->lockForUpdate()->firstOrFail();
            $vehicle->refresh();

            // The policy looked before this lock. A second tap that got past it, or a delete in between, changes nothing.
            if (! $vehicle->isDraft() || $vehicle->trashed()) {
                return;
            }

            $this->assertComplete($owner, $vehicle);

            $firstOfMember = ! $owner->vehicles()->where('is_main', true)->exists();
            $firstPublish = $vehicle->getAttribute('published_at') === null;

            $vehicle->forceFill([
                'status' => VehicleStatus::Published,
                'published_at' => $vehicle->getAttribute('published_at') ?? now(),
                'wizard_step' => null,
                'is_main' => $firstOfMember,
                'visibility' => $visibility ?? $vehicle->visibility,
                'slug' => $vehicle->canonicalSlug(),
                'cover_media_id' => $vehicle->getAttribute('cover_media_id') ?? $this->firstPhoto($vehicle),
            ])->save();

            $this->qr->ensureActive($vehicle);
            $this->search->rebuild($vehicle->id);
            $this->og->queue($vehicle);

            // Followers hear of a build once, at its first publish as public (followed_published, M2.2).
            if ($firstPublish) {
                $this->fanout->vehiclePublished($vehicle);
            }
        }, self::ATTEMPTS);

        return $vehicle;
    }

    /**
     * @throws ApiException 422 vehicle_incomplete
     */
    private function assertComplete(User $owner, Vehicle $vehicle): void
    {
        $missing = [
            ...$vehicle->missingBasics(),
            ...array_keys(array_filter([
                'photo' => $this->firstPhoto($vehicle) === null,
                'username' => ! $owner->hasUsername(),
            ])),
        ];

        if ($missing !== []) {
            $errors = [];

            foreach ($missing as $key) {
                $errors[$key] = [(string) __('garage.publish_missing.'.$key)];
            }

            throw new ApiException(ErrorCode::VehicleIncomplete, errors: $errors, data: ['missing' => $missing]);
        }
    }

    private function firstPhoto(Vehicle $vehicle): ?string
    {
        /** @var string|null $id */
        $id = $vehicle->media()->usablePhoto()->orderBy('sort')->orderBy('id')->value('id');

        return $id;
    }
}
