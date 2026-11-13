<?php

namespace App\Http\Controllers\Api\V1\Social2;

use App\Actions\Social\Collections\AddCollectionItem;
use App\Actions\Social\Collections\RemoveCollectionItem;
use App\Actions\Social\Collections\ReorderCollectionItems;
use App\Enums\CollectionItemType;
use App\Http\Controllers\Controller;
use App\Http\Requests\Api\V1\Social2\CollectionItemRequest;
use App\Http\Requests\Api\V1\Social2\ReorderRequest;
use App\Http\Requests\Api\V1\Social2\SocialListRequest;
use App\Http\Resources\V1\FeedVehicleResource;
use App\Http\Resources\V1\MemberCollectionItemResource;
use App\Models\BuildUpdate;
use App\Models\Event;
use App\Models\MemberCollection;
use App\Models\Modification;
use App\Models\User;
use App\Models\Vehicle;
use App\Services\Events\EventPresenter;
use App\Services\Social\Collections;
use Illuminate\Http\Resources\Json\AnonymousResourceCollection;
use Illuminate\Http\Response;
use Illuminate\Support\Facades\Gate;

/**
 * COL-02: the wall of one collection (09 §7.7): builds, mods, build updates and events; add, remove, reorder. Private.
 */
class CollectionItemController extends Controller
{
    /**
     * List a collection's items.
     *
     * Newest (highest position) first. Items the member can no longer see stay stored and are left out while that lasts.
     */
    public function index(SocialListRequest $request, MemberCollection $collection, Collections $collections, EventPresenter $events): AnonymousResourceCollection
    {
        Gate::authorize('view', $collection);

        /** @var User $user */
        $user = $request->user();
        $page = $collection->items()
            ->orderByDesc('member_collection_items.position')
            ->orderByDesc('member_collection_items.id')
            ->cursorPaginate($request->pageSize())
            ->withQueryString();

        $byType = fn (CollectionItemType $type): array => $page->getCollection()->filter(fn ($item): bool => $item->item_type === $type)->pluck('item_id')->all();
        $targets = [
            CollectionItemType::Vehicle->value => Vehicle::query()->whereKey($byType(CollectionItemType::Vehicle))->with(FeedVehicleResource::RELATIONS)->withCount('modifications')->get()->keyBy('id'),
            CollectionItemType::Modification->value => Modification::query()->whereKey($byType(CollectionItemType::Modification))->with(['vehicle', 'category'])->get()->keyBy('id'),
            CollectionItemType::BuildUpdate->value => BuildUpdate::query()->whereKey($byType(CollectionItemType::BuildUpdate))
                ->with(['vehicle' => fn ($query) => $query->with(['make', 'vehicleModel', 'generation', 'cover', 'media'])])->get()->keyBy('id'),
            CollectionItemType::Event->value => Event::query()->whereKey($byType(CollectionItemType::Event))->with('organiser')->get()->keyBy('id'),
        ];

        $page->setCollection($page->getCollection()->filter(function ($item) use ($targets, $collections, $user): bool {
            $target = $targets[$item->item_type->value]->get($item->item_id);

            if ($target === null || ! $collections->visible($user, $target)) {
                return false;
            }

            $item->setRelation('target', $target);

            return true;
        })->values());
        $events->prepare($page->getCollection()->map(fn ($item) => $item->getRelation('target'))->filter(fn ($target): bool => $target instanceof Event)->values()->all(), $user);

        return MemberCollectionItemResource::collection($page);
    }

    /**
     * Add an item to a collection.
     *
     * Accepts an Idempotency-Key header. `type` vehicle, modification, build_update or event, `id` its id. Only what you can see now (404
     * otherwise); your own build: 403. Adding twice keeps the first. A build in any collection counts as saved. Up to 1,000 items (409
     * limit_reached).
     */
    public function store(CollectionItemRequest $request, MemberCollection $collection, AddCollectionItem $action, Collections $collections, EventPresenter $events): MemberCollectionItemResource
    {
        Gate::authorize('update', $collection);

        /** @var User $user */
        $user = $request->user();
        $type = CollectionItemType::from($request->string('type')->toString());
        $item = $action->handle($user, $collection, $type, $request->string('id')->lower()->toString());
        $target = $collections->find($type, $item->item_id);

        if ($target instanceof Vehicle) {
            $target->load(FeedVehicleResource::RELATIONS)->loadCount('modifications');
        }

        if ($target instanceof Event) {
            $events->prepare([$target], $user);
        }

        $item->setRelation('target', $target);

        /** @status 201 */
        return new MemberCollectionItemResource($item);
    }

    /**
     * Remove an item from a collection.
     *
     * By type and id, whatever the item's state now. Answers 204.
     */
    public function destroy(MemberCollection $collection, string $type, string $id, RemoveCollectionItem $action): Response
    {
        Gate::authorize('update', $collection);

        $kind = CollectionItemType::tryFrom($type);

        if ($kind !== null) {
            $action->handle($collection, $kind, $id);
        }

        return response()->noContent();
    }

    /**
     * Reorder a collection's items.
     *
     * `ids` as "type:id", top first, every stored item exactly once (422 otherwise). Answers 204.
     */
    public function reorder(ReorderRequest $request, MemberCollection $collection, ReorderCollectionItems $action): Response
    {
        Gate::authorize('update', $collection);

        /** @var list<string> $keys */
        $keys = $request->validated('ids');
        $action->handle($collection, $keys);

        return response()->noContent();
    }
}
