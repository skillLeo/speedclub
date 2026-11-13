<?php

namespace App\Actions\Garage;

use App\Enums\ErrorCode;
use App\Enums\KeywordField;
use App\Enums\VehicleStatus;
use App\Exceptions\ApiException;
use App\Models\User;
use App\Models\Vehicle;
use App\Services\Garage\VehicleAttributes;
use App\Services\Maintenance\MaintenanceItems;
use App\Services\Rules\ContentScreen;
use App\Support\Codes;
use App\Support\Slug;
use Illuminate\Support\Facades\DB;

/**
 * GAR-03 starts here: a draft, at step 1 unless the wizard says otherwise. The limit counts drafts too and is checked under the
 * member's row lock, so parallel requests cannot overshoot it.
 */
class CreateVehicleDraft
{
    public function __construct(
        private readonly VehicleAttributes $attributes,
        private readonly ContentScreen $screen,
    ) {}

    /**
     * @param  array<string, mixed>  $attributes  validated
     */
    public function handle(User $user, array $attributes): Vehicle
    {
        // M3.4 (ADM-23): a block-list term refuses the write (422 content_blocked); a flag-list term files an automated report.
        $flags = $this->screen->screen(self::screened($attributes));

        return DB::transaction(function () use ($user, $attributes, $flags): Vehicle {
            User::query()->whereKey($user->id)->lockForUpdate()->value('id');

            $limit = config()->integer('speedclub.garage.max_vehicles_per_member');

            if ($user->vehicles()->count() >= $limit) {
                $reason = (string) __('garage.limit_reached', ['max' => $limit]);

                throw new ApiException(ErrorCode::ValidationFailed, $reason, errors: ['vehicle' => [$reason]]);
            }

            $sort = $user->vehicles()->withTrashed()->max('sort');

            $vehicle = Codes::createUnique(function (string $publicId) use ($user, $attributes, $sort): Vehicle {
                $vehicle = new Vehicle;
                $vehicle->forceFill([
                    'owner_id' => $user->id,
                    'public_id' => $publicId,
                    'status' => VehicleStatus::Draft,
                    'wizard_step' => 1,
                    'sort' => is_numeric($sort) ? (int) $sort + 1 : 0,
                    'slug' => Slug::forVehicle(null, null, null, $publicId),
                ]);

                $this->attributes->apply($vehicle, $attributes);
                $vehicle->save();
                // M4.13 (09 §8.8): the HU/AU month and the HU/AU maintenance item stay one.
                if (array_key_exists('hu_au_due', $attributes)) {
                    app(MaintenanceItems::class)->huAuMonthChanged($vehicle, $vehicle->getAttribute('hu_au_due')?->format('Y-m-d'));
                }

                return $vehicle;
            });

            $this->attributes->fileCatalogRequest($user, $vehicle, $attributes);
            $this->screen->flagAfterCommit($flags, $vehicle);

            return $vehicle;
        });
    }

    /**
     * @param  array<string, mixed>  $attributes
     * @return array<string, array{0: KeywordField, 1: string|null}>
     */
    public static function screened(array $attributes): array
    {
        $fields = [];

        foreach (['description' => KeywordField::VehicleDescription, 'nickname' => KeywordField::VehicleNickname] as $name => $kind) {
            if (is_string($attributes[$name] ?? null)) {
                $fields[$name] = [$kind, $attributes[$name]];
            }
        }

        return $fields;
    }
}
