<?php

namespace App\Http\Controllers\Api\V1\Businesses;

use App\Actions\Businesses\ModTags;
use App\Enums\ErrorCode;
use App\Enums\ModTagInitiator;
use App\Exceptions\ApiException;
use App\Http\Controllers\Controller;
use App\Http\Requests\Api\V1\Businesses\DecideTagRequest;
use App\Http\Requests\Api\V1\Businesses\ModTagRequest;
use App\Http\Requests\Api\V1\Businesses\TagListRequest;
use App\Http\Resources\V1\ModTagResource;
use App\Models\ModBusinessTag;
use App\Models\Modification;
use App\Models\User;
use Illuminate\Http\Request;
use Illuminate\Http\Resources\Json\AnonymousResourceCollection;
use Illuminate\Http\Response;
use Illuminate\Support\Facades\Gate;

/**
 * The build owner's side of "Eingebaut von" (09 §8.10): tag a business on an own mod (GAR-10, VEH-02), take it off, and confirm or
 * decline what businesses proposed.
 */
class ModBusinessTagController extends Controller
{
    use FindsBusinesses;

    /**
     * Tag a business on a mod.
     *
     * The mod's owner names the business (`business`: its slug) that installed the part; the business confirms (BIZ-04). Confirms a
     * pending proposal of the same business at once; replaces another business's tag. The business must be verified (409
     * business_not_verified). 201 when a tag was created, 200 when an existing one was confirmed or kept.
     */
    public function update(ModTagRequest $request, string $modification, ModTags $tags): ModTagResource
    {
        /** @var User $user */
        $user = $request->user();
        $mod = $this->ownMod($user, $modification);
        $business = $this->findBusiness((string) $request->validated('business'), $user);

        return new ModTagResource($tags->request($user, $mod, $business)->load(['business', 'modification.vehicle.owner', 'modification.category']));
    }

    /**
     * Remove the tag of a mod.
     *
     * The mod's owner takes "Eingebaut von" off (also declining a pending proposal this way); the portfolio loses the build. Answers 204,
     * also when there was none.
     */
    public function destroy(Request $request, string $modification, ModTags $tags): Response
    {
        /** @var User $user */
        $user = $request->user();
        $mod = $this->ownMod($user, $modification, 'delete');
        $tag = ModBusinessTag::query()->where('mod_id', $mod->id)->first();

        if ($tag instanceof ModBusinessTag) {
            $tags->remove($user, $tag);
        }

        return response()->noContent();
    }

    /**
     * List the tags on my mods.
     *
     * `direction=incoming` (default): businesses proposed, the member confirms; `outgoing`: the member asked. `status` (default pending).
     * Newest first; cursor pages.
     */
    public function index(TagListRequest $request): AnonymousResourceCollection
    {
        /** @var User $user */
        $user = $request->user();

        $page = ModBusinessTag::query()->with(['business', 'modification.vehicle.owner', 'modification.category'])
            ->whereHas('modification.vehicle', fn ($vehicle) => $vehicle->where('owner_id', $user->id))
            ->where('status', $request->status()->value)
            ->where('initiated_by', ($request->incoming() ? ModTagInitiator::Business : ModTagInitiator::Member)->value)
            ->orderByDesc('created_at')->orderByDesc('id')
            ->cursorPaginate($request->pageSize())->withQueryString();

        return ModTagResource::collection($page);
    }

    /**
     * Decide a business's proposal.
     *
     * The build's owner: `decision` accepted (the build joins the business's portfolio) or declined. Only a business's pending proposal
     * on an own mod (403 for the member's own requests, 409 when decided).
     */
    public function decide(DecideTagRequest $request, string $tag, ModTags $tags): ModTagResource
    {
        /** @var User $user */
        $user = $request->user();
        $row = ModBusinessTag::query()->whereHas('modification.vehicle', fn ($vehicle) => $vehicle->where('owner_id', $user->id))->find(strtolower($tag));

        if (! $row instanceof ModBusinessTag) {
            throw new ApiException(ErrorCode::NotFound);
        }

        return new ModTagResource($tags->decide($user, $row, $request->isAccepted())->load(['business', 'modification.vehicle.owner', 'modification.category']));
    }

    private function ownMod(User $user, string $id, string $ability = 'update'): Modification
    {
        $mod = Modification::query()->with('vehicle.owner')->find(strtolower($id));

        if (! $mod instanceof Modification || ! Gate::forUser($user)->allows('view', $mod)) {
            throw new ApiException(ErrorCode::NotFound);
        }

        Gate::forUser($user)->authorize($ability, $mod);

        return $mod;
    }
}
