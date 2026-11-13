<?php

namespace App\Http\Controllers\Api\V1\Social2;

use App\Actions\Social\Collections\CreateCollection;
use App\Actions\Social\Collections\DeleteCollection;
use App\Actions\Social\Collections\RenameCollection;
use App\Actions\Social\Collections\ReorderCollections;
use App\Enums\CollectionItemType;
use App\Http\Controllers\Controller;
use App\Http\Requests\Api\V1\Social2\CollectionListRequest;
use App\Http\Requests\Api\V1\Social2\CollectionRequest;
use App\Http\Requests\Api\V1\Social2\ReorderRequest;
use App\Http\Resources\V1\MemberCollectionResource;
use App\Models\MemberCollection;
use App\Models\User;
use App\Services\Social\Collections;
use Illuminate\Http\Resources\Json\AnonymousResourceCollection;
use Illuminate\Http\Response;
use Illuminate\Support\Collection;
use Illuminate\Support\Facades\Gate;

/**
 * COL-01 Sammlungen (09 §7.7, §8.6, flag collections): private collections, the default "Gespeichert" first. No verification needed
 * (as saves, ADR-139). While the flag is off every route answers 404 feature_disabled.
 */
class CollectionController extends Controller
{
    /**
     * List my collections.
     *
     * In my order, "Gespeichert" created on first use. With contains_type and contains_id (the save sheet) each says whether it holds
     * that item.
     */
    public function index(CollectionListRequest $request, Collections $collections): AnonymousResourceCollection
    {
        /** @var User $user */
        $user = $request->user();
        Gate::authorize('viewAny', MemberCollection::class);
        $collections->defaultFor($user);

        $type = $request->filled('contains_type') ? CollectionItemType::from($request->string('contains_type')->toString()) : null;
        $id = $request->string('contains_id')->lower()->toString();

        $rows = MemberCollection::query()
            ->where('user_id', $user->id)
            ->withCount('items')
            ->when($type !== null, fn ($query) => $query->withExists(['items as contains' => fn ($items) => $items->where('item_type', $type)->where('item_id', $id)]))
            ->orderByDesc('is_default')
            ->orderBy('position')
            ->orderBy('created_at')
            ->get();

        foreach ($rows as $collection) {
            $collection->setRelation('covers', app(Collections::class)->covers($user, $collection));
        }

        return MemberCollectionResource::collection($rows);
    }

    /**
     * Create a collection.
     *
     * Accepts an Idempotency-Key header. Up to 50 collections (409 limit_reached).
     */
    public function store(CollectionRequest $request, CreateCollection $action): MemberCollectionResource
    {
        /** @var User $user */
        $user = $request->user();
        Gate::authorize('create', MemberCollection::class);

        $collection = $action->handle($user, $request->string('name')->toString())->loadCount('items');
        $collection->setRelation('covers', collect());

        /** @status 201 */
        return new MemberCollectionResource($collection);
    }

    /**
     * Rename a collection.
     *
     * "Gespeichert" too. Another member's collection: 403.
     */
    public function update(CollectionRequest $request, MemberCollection $collection, RenameCollection $action): MemberCollectionResource
    {
        Gate::authorize('update', $collection);

        /** @var User $user */
        $user = $request->user();
        $collection = $action->handle($collection, $request->string('name')->toString())->loadCount('items');
        $collection->setRelation('covers', app(Collections::class)->covers($user, $collection));

        return new MemberCollectionResource($collection);
    }

    /**
     * Delete a collection.
     *
     * With its entries; builds in no other collection stop being saved. "Gespeichert": 409. Answers 204.
     */
    public function destroy(MemberCollection $collection, DeleteCollection $action): Response
    {
        Gate::authorize('delete', $collection);

        $action->handle($collection);

        return response()->noContent();
    }

    /**
     * Reorder my collections.
     *
     * `ids` top first, every collection exactly once (422 otherwise). Answers 204.
     */
    public function reorder(ReorderRequest $request, ReorderCollections $action): Response
    {
        /** @var User $user */
        $user = $request->user();
        Gate::authorize('viewAny', MemberCollection::class);

        /** @var list<string> $ids */
        $ids = $request->validated('ids');
        $action->handle($user, $ids);

        return response()->noContent();
    }
}
