<?php

namespace App\Services\Discover;

use App\Services\Home\PopularMod;

/**
 * DISC-01 below the search field (FS-11): make tiles, Kollektionen, Beliebte Mods and [SIG] Mitglieder mit ähnlichen Autos.
 */
final readonly class DiscoverPage
{
    /**
     * @param  list<MakeTile>  $makes
     * @param  list<CollectionCard>  $collections
     * @param  list<PopularMod>  $popularMods
     * @param  list<MemberHit>|null  $similarMembers
     */
    public function __construct(
        public array $makes,
        public array $collections = [],
        public array $popularMods = [],
        public ?array $similarMembers = null,
    ) {}
}
