<?php

namespace App\Services\Discover;

use App\Enums\VehicleStatus;
use App\Enums\Visibility;
use App\Models\User;
use App\Models\Vehicle;

/**
 * "Mitglieder mit ähnlichen Autos" of DISC-01 [SIG sig.similar_builds] (m2.3 contract §5): members whose visible builds share a model
 * with one of the viewer's public builds, then those sharing only a make; within each, the member whose matching build changed last
 * first. Only discoverable members, and not those who hide their name on their builds (show_owner_on_qr false, ADR-148 a), as the row
 * pairs a member with a car; the viewer and blocks either way are left out. Null for a guest or a viewer without a public build.
 */
final class SimilarMembers
{
    public function __construct(
        private readonly VisibleBuilds $builds,
        private readonly TextSearch $search,
    ) {}

    /**
     * @return list<MemberHit>|null
     */
    public function for(?User $viewer): ?array
    {
        if ($viewer === null) {
            return null;
        }

        $own = Vehicle::query()
            ->where('owner_id', $viewer->id)
            ->where('status', VehicleStatus::Published)
            ->where('visibility', Visibility::Public)
            ->get(['id', 'make_id', 'model_id']);
        $makes = array_values(array_unique(array_filter($own->pluck('make_id')->all())));
        $models = array_values(array_unique(array_filter($own->pluck('model_id')->all())));

        if ($makes === []) {
            return null;
        }

        $modelCase = $models === []
            ? '1'
            : 'CASE WHEN vs.model_id IN ('.implode(', ', array_fill(0, count($models), '?')).') THEN 2 ELSE 1 END';

        $rows = $this->builds->query($viewer)
            ->where('vs.owner_id', '<>', $viewer->id)
            ->whereIn('vs.make_id', $makes)
            ->where('u.discoverable', true)
            ->whereNotNull('u.username')
            ->where(fn ($shown) => $shown->whereNull('u.show_owner_on_qr')->orWhere('u.show_owner_on_qr', true))
            ->groupBy('vs.owner_id', 'u.username')
            ->select('vs.owner_id', 'u.username')
            ->selectRaw("MAX($modelCase) as tier", $models)
            // The matching build changed last (m2.3 handover §5, M2.3 review #17): for a member of the model tier that is a build of one of
            // the viewer's models, not a later one that only shares the make.
            ->selectRaw($models === []
                ? 'MAX('.VisibleBuilds::CHANGED_AT.') as last_change'
                : 'COALESCE(MAX(CASE WHEN vs.model_id IN ('.implode(', ', array_fill(0, count($models), '?')).') THEN '.VisibleBuilds::CHANGED_AT.' END), MAX('.VisibleBuilds::CHANGED_AT.')) as last_change', $models)
            ->orderByDesc('tier')->orderByDesc('last_change')->orderBy('u.username')
            ->limit(config()->integer('speedclub.search.similar_members'))
            ->get();

        $members = User::query()->whereKey($rows->pluck('owner_id')->all())->with('avatar')->get()->keyBy('id');
        $hits = [];

        foreach ($rows as $row) {
            $member = $members->get((string) VisibleBuilds::column($row, 'owner_id'));

            if ($member instanceof User) {
                $hits[] = new MemberHit($member, (string) VisibleBuilds::column($row, 'username'), (int) VisibleBuilds::column($row, 'tier'));
            }
        }

        $this->search->addGarages($hits);
        $this->search->addFollowing($viewer, $hits);

        return $hits === [] ? null : $hits;
    }
}
