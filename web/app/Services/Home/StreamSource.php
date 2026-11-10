<?php

namespace App\Services\Home;

/**
 * What the Für dich assembler reads. Positions are exclusive: rows after them in the stream's order.
 */
interface StreamSource
{
    /**
     * @param  array{0: string, 1: string, 2: string}|null  $after  [score, changed at "Y-m-d H:i:s", vehicle id]
     * @param  list<string>  $exclude
     * @return list<StreamVehicle> by score, then changed at, then id, all descending
     */
    public function vehiclesAfter(?array $after, array $exclude, int $limit): array;

    /**
     * The given builds that are still visible, in the stream's order.
     *
     * @param  list<string>  $ids
     * @return list<StreamVehicle>
     */
    public function vehiclesByIds(array $ids): array;

    /**
     * @param  array{0: string, 1: string}|null  $after  [created_at, update id]
     * @param  list<string>  $exclude
     * @return list<StreamUpdate> newest first
     */
    public function updatesAfter(?array $after, array $exclude, int $limit): array;
}
