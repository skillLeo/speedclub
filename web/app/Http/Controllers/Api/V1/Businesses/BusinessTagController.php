<?php

namespace App\Http\Controllers\Api\V1\Businesses;

use App\Actions\Businesses\ModTags;
use App\Enums\ErrorCode;
use App\Enums\ModTagInitiator;
use App\Exceptions\ApiException;
use App\Http\Controllers\Controller;
use App\Http\Requests\Api\V1\Businesses\DecideTagRequest;
use App\Http\Requests\Api\V1\Businesses\ProposeTagRequest;
use App\Http\Requests\Api\V1\Businesses\TagListRequest;
use App\Http\Resources\V1\ModTagResource;
use App\Models\Business;
use App\Models\ModBusinessTag;
use App\Models\Modification;
use App\Models\User;
use Illuminate\Http\Request;
use Illuminate\Http\Resources\Json\AnonymousResourceCollection;
use Illuminate\Http\Response;

/**
 * BIZ-03 Portfolio and BIZ-04 Anfragen (09 §8.10): the business team sees the tags of its business, confirms or declines the members'
 * requests (the undo toast deletes the tag again), proposes builds it worked on and takes tags off.
 */
class BusinessTagController extends Controller
{
    use FindsBusinesses;

    /**
     * List my business's tags.
     *
     * Owner and staff. `direction=incoming` (default): members asked, the business decides; `outgoing`: the business proposed.
     * `status` (default pending). Newest first; cursor pages.
     */
    public function index(TagListRequest $request): AnonymousResourceCollection
    {
        /** @var User $user */
        $user = $request->user();
        $business = $this->myBusiness($user);

        $page = ModBusinessTag::query()->with(['business', 'modification.vehicle.owner', 'modification.category'])
            ->where('business_id', $business->id)
            ->where('status', $request->status()->value)
            ->where('initiated_by', ($request->incoming() ? ModTagInitiator::Member : ModTagInitiator::Business)->value)
            ->orderByDesc('created_at')->orderByDesc('id')
            ->cursorPaginate($request->pageSize())->withQueryString();

        return ModTagResource::collection($page);
    }

    /**
     * Propose a build.
     *
     * Accepts an Idempotency-Key header. The business names a mod of a public build it worked on; the build's owner confirms. The
     * business must be verified (409 business_not_verified); a mod with another business's tag: 409 conflict; at most 100 open
     * proposals (409 limit_reached).
     */
    public function store(ProposeTagRequest $request, ModTags $tags): ModTagResource
    {
        /** @var User $user */
        $user = $request->user();
        $business = $this->myBusiness($user);
        $mod = Modification::query()->with('vehicle.owner')->find(strtolower((string) $request->validated('mod_id')));

        if (! $mod instanceof Modification) {
            throw new ApiException(ErrorCode::NotFound);
        }

        $tag = $tags->propose($user, $business, $mod);

        /** @status 201 */
        return new ModTagResource($tag->load(['business', 'modification.vehicle.owner', 'modification.category']));
    }

    /**
     * Decide a request.
     *
     * Owner and staff: `decision` accepted (the build joins the portfolio) or declined. Only a member's pending request (403 for the
     * business's own proposals, 409 when decided).
     */
    public function update(DecideTagRequest $request, string $tag, ModTags $tags): ModTagResource
    {
        /** @var User $user */
        $user = $request->user();
        $row = $this->tag($this->myBusiness($user), $tag);

        return new ModTagResource($tags->decide($user, $row, $request->isAccepted())->load(['business', 'modification.vehicle.owner', 'modification.category']));
    }

    /**
     * Remove a tag.
     *
     * Owner and staff: withdraws a proposal or takes a build off the portfolio (the undo of BIZ-04 too). Answers 204.
     */
    public function destroy(Request $request, string $tag, ModTags $tags): Response
    {
        /** @var User $user */
        $user = $request->user();
        $tags->remove($user, $this->tag($this->myBusiness($user), $tag));

        return response()->noContent();
    }

    private function tag(Business $business, string $id): ModBusinessTag
    {
        $tag = ModBusinessTag::query()->where('business_id', $business->id)->find(strtolower($id));

        if (! $tag instanceof ModBusinessTag) {
            throw new ApiException(ErrorCode::NotFound);
        }

        return $tag;
    }
}
