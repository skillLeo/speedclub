<?php

namespace App\Http\Controllers\Api\V1\Crews;

use App\Actions\Crews\CreateCrew;
use App\Actions\Crews\CrewMediaSlot;
use App\Actions\Crews\DeleteCrew;
use App\Actions\Crews\UpdateCrew;
use App\Http\Controllers\Controller;
use App\Http\Requests\Api\V1\Crews\CrewListRequest;
use App\Http\Requests\Api\V1\Crews\CrewMediaRequest;
use App\Http\Requests\Api\V1\Crews\CrewPageRequest;
use App\Http\Requests\Api\V1\Crews\DeleteCrewRequest;
use App\Http\Requests\Api\V1\Crews\StoreCrewRequest;
use App\Http\Requests\Api\V1\Crews\UpdateCrewRequest;
use App\Http\Resources\V1\Crews\CrewCardResource;
use App\Http\Resources\V1\Crews\CrewMemberResource;
use App\Http\Resources\V1\Crews\CrewResource;
use App\Http\Resources\V1\MediaResource;
use App\Models\Crew;
use App\Models\User;
use App\Services\Crews\CrewListing;
use App\Support\Viewer;
use Illuminate\Http\Request;
use Illuminate\Http\Resources\Json\AnonymousResourceCollection;
use Illuminate\Http\Response;
use Illuminate\Http\UploadedFile;
use Illuminate\Support\Facades\Gate;

/**
 * R4-2.3 Crews (contract-crews.md §3 #1–3, #8–12): CREW-00 list, CREW-01 page and members, founding, editing, logo and cover, deleting.
 * Flag `crews`.
 */
class CrewController extends Controller
{
    use FindsCrews;

    /**
     * List crews.
     *
     * CREW-00: active crews, `q` in the name, `bundesland`, `sort` name (A–Z, default) or newest; real crews before samples. Never by
     * size. Guests too.
     *
     * @unauthenticated
     */
    public function index(CrewListRequest $request, CrewListing $listing): AnonymousResourceCollection
    {
        return CrewCardResource::collection($listing->search($request->filters(), Viewer::from($request), $request->pageSize()));
    }

    /**
     * Show a crew.
     *
     * CREW-01. An old slug (before a rename) answers the crew with its current `slug`: the client redirects. A crew staff hid answers
     * only its own members (with `status`); anybody else, and a deleted crew: 404 crew_unavailable. Guests too.
     *
     * @unauthenticated
     */
    public function show(Request $request, string $slug): CrewResource
    {
        $viewer = Viewer::from($request);

        return $this->present($this->crew($slug, $viewer), $viewer);
    }

    /**
     * List a crew's members.
     *
     * Founder, admins, then members, each by when they joined, with up to three public builds each. Members the reader may not see (a
     * block either way, unverified, suspended, closing) are left out. Guests too.
     *
     * @unauthenticated
     */
    public function members(CrewPageRequest $request, string $slug, CrewListing $listing): AnonymousResourceCollection
    {
        $viewer = Viewer::from($request);

        return CrewMemberResource::collection($listing->members($this->crew($slug, $viewer), $viewer, $request->pageSize()));
    }

    /**
     * Found a crew.
     *
     * Accepts an Idempotency-Key header. The member becomes its founder. At most 2 crews founded and 5 memberships (409 limit_reached).
     * Name 3–40 characters, unique regardless of case, no reserved word (422); keyword rules on name and description (422
     * content_blocked).
     */
    public function store(StoreCrewRequest $request, CreateCrew $action): CrewResource
    {
        /** @var User $user */
        $user = $request->user();
        Gate::authorize('create', Crew::class);

        /** @status 201 */
        return $this->present($action->handle($user, $request->details()), $user);
    }

    /**
     * Change a crew.
     *
     * Founder and admins; only the keys sent change. A new name gets a new slug and the old one keeps working. A hidden crew: 409.
     */
    public function update(UpdateCrewRequest $request, string $slug, UpdateCrew $action): CrewResource
    {
        /** @var User $user */
        $user = $request->user();
        $crew = $this->crew($slug, $user);
        Gate::authorize('update', $crew);

        return $this->present($action->handle($user, $crew, $request->details()), $user);
    }

    /**
     * Delete a crew.
     *
     * The founder, with `confirm_name` (the crew's name). Members, requests and invitations go; the name is free again. Answers 204.
     */
    public function destroy(DeleteCrewRequest $request, string $slug, DeleteCrew $action): Response
    {
        /** @var User $user */
        $user = $request->user();
        $crew = $this->crew($slug, $user);
        Gate::authorize('manage', $crew);
        $action->handle($user, $crew, $request->confirmName());

        return response()->noContent();
    }

    /**
     * Upload the crew logo.
     *
     * Accepts an Idempotency-Key header. Founder and admins. Square; re-encoded without metadata, WebP variants; replaces the old one.
     */
    public function logo(CrewMediaRequest $request, string $slug, CrewMediaSlot $action): MediaResource
    {
        return $this->upload($request, $slug, $action, 'logo');
    }

    /**
     * Upload the crew cover.
     *
     * Accepts an Idempotency-Key header. Founder and admins. 16:9; re-encoded without metadata, WebP variants; replaces the old one.
     */
    public function cover(CrewMediaRequest $request, string $slug, CrewMediaSlot $action): MediaResource
    {
        return $this->upload($request, $slug, $action, 'cover');
    }

    /**
     * Remove the crew logo.
     *
     * Founder and admins. Answers 204.
     */
    public function removeLogo(Request $request, string $slug, CrewMediaSlot $action): Response
    {
        return $this->removeMedia($request, $slug, $action, 'logo');
    }

    /**
     * Remove the crew cover.
     *
     * Founder and admins. Answers 204.
     */
    public function removeCover(Request $request, string $slug, CrewMediaSlot $action): Response
    {
        return $this->removeMedia($request, $slug, $action, 'cover');
    }

    /**
     * @param  'logo'|'cover'  $slot
     */
    private function upload(CrewMediaRequest $request, string $slug, CrewMediaSlot $action, string $slot): MediaResource
    {
        /** @var User $user */
        $user = $request->user();
        $crew = $this->crew($slug, $user);
        Gate::authorize('update', $crew);
        $file = $request->file('file');
        abort_unless($file instanceof UploadedFile, 422);

        /** @status 201 */
        return new MediaResource($action->upload($user, $crew, $slot, $file, $request->mediaAttributes(), $request->plateBlur()));
    }

    /**
     * @param  'logo'|'cover'  $slot
     */
    private function removeMedia(Request $request, string $slug, CrewMediaSlot $action, string $slot): Response
    {
        /** @var User $user */
        $user = $request->user();
        $crew = $this->crew($slug, $user);
        Gate::authorize('update', $crew);
        $action->remove($crew, $slot);

        return response()->noContent();
    }
}
