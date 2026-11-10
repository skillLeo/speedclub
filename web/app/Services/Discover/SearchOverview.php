<?php

namespace App\Services\Discover;

use App\Models\Vehicle;
use Illuminate\Contracts\Pagination\CursorPaginator;

/**
 * GET search: the first results of each kind with the counts of the tabs "Fahrzeuge (124) · Mitglieder (8)" (FS-11).
 */
final readonly class SearchOverview
{
    /**
     * @param  CursorPaginator<int, Vehicle>  $vehicles
     * @param  CursorPaginator<int, MemberHit>  $members
     */
    public function __construct(
        public string $query,
        public CursorPaginator $vehicles,
        public ResultCount $vehicleCount,
        public CursorPaginator $members,
        public ResultCount $memberCount,
    ) {}
}
