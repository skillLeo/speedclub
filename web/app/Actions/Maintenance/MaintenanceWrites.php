<?php

namespace App\Actions\Maintenance;

use App\Enums\ErrorCode;
use App\Exceptions\ApiException;
use App\Models\Vehicle;
use Closure;
use Illuminate\Database\Eloquent\Model;
use Illuminate\Support\Facades\DB;

/**
 * What every maintenance write shares (09 §8.12 offline outbox): the vehicle's row lock, so two devices flushing their outboxes write one
 * after the other, and the optimistic version check of edits.
 */
final class MaintenanceWrites
{
    /**
     * @template T
     *
     * @param  Closure(Vehicle): T  $write
     * @return T
     */
    public static function locked(Vehicle $vehicle, Closure $write): mixed
    {
        return DB::transaction(function () use ($vehicle, $write): mixed {
            /** @var Vehicle $locked */
            $locked = Vehicle::query()->whereKey($vehicle->id)->lockForUpdate()->firstOrFail();

            return $write($locked);
        });
    }

    /**
     * 409 edit_conflict with the server's row in `current` when the edit started from an older version; the client shows both and lets
     * the member choose (or re-applies its change onto `current`).
     *
     * @param  array<string, mixed>  $data  validated
     * @param  Closure(): array<string, mixed>  $current  the row as its resource renders it
     */
    public static function assertVersion(Model $row, array $data, Closure $current): void
    {
        $sent = $data['version'] ?? null;

        if (is_int($sent) && $sent !== (int) $row->getAttribute('version')) {
            throw new ApiException(ErrorCode::EditConflict, data: ['current' => $current()]);
        }
    }
}
