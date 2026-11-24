<?php

namespace App\Services\Forum;

use App\Enums\ErrorCode;
use App\Enums\ProductStatus;
use App\Exceptions\ApiException;
use App\Models\Modification;
use App\Models\Product;
use App\Models\User;
use App\Models\Vehicle;

/**
 * The optional attachment of a thread (10 §7.1, m5.8-contract §2): one of the author's own vehicles, a mod of it (or of any own vehicle,
 * which then becomes the attached vehicle), and an active parts catalogue product. Anything else is a validation error on its field,
 * never a hint that a stranger's vehicle exists.
 */
final class ForumAttachments
{
    /**
     * @return array{vehicle_id: string|null, modification_id: string|null, product_id: string|null}
     *
     * @throws ApiException 422 validation_failed
     */
    public function resolve(User $author, ?string $vehicleId, ?string $modificationId, ?string $productId): array
    {
        $errors = [];
        $vehicle = null;

        if ($vehicleId !== null) {
            $vehicle = Vehicle::query()->whereKey(strtolower($vehicleId))->where('owner_id', $author->id)->first();

            if (! $vehicle instanceof Vehicle) {
                $errors['vehicle_id'] = [(string) __('forum.attachments.vehicle')];
            }
        }

        $mod = null;

        if ($modificationId !== null) {
            $mod = Modification::query()->whereKey(strtolower($modificationId))
                ->whereHas('vehicle', fn ($own) => $own->where('owner_id', $author->id))->first();

            if (! $mod instanceof Modification || ($vehicle instanceof Vehicle && $mod->vehicle_id !== $vehicle->id)) {
                $errors['modification_id'] = [(string) __('forum.attachments.modification')];
                $mod = null;
            }
        }

        $product = null;

        if ($productId !== null) {
            $product = Product::query()->whereKey(strtolower($productId))->where('status', ProductStatus::Active->value)->first();

            if (! $product instanceof Product) {
                $errors['product_id'] = [(string) __('forum.attachments.product')];
            }
        }

        if ($errors !== []) {
            throw new ApiException(ErrorCode::ValidationFailed, errors: $errors);
        }

        return [
            'vehicle_id' => $vehicle->id ?? $mod?->vehicle_id,
            'modification_id' => $mod?->id,
            'product_id' => $product?->id,
        ];
    }
}
