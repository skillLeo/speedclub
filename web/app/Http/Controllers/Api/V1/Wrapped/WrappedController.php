<?php

namespace App\Http\Controllers\Api\V1\Wrapped;

use App\Actions\Wrapped\FindMyWrapped;
use App\Actions\Wrapped\ListMyWrapped;
use App\Actions\Wrapped\MarkWrappedShared;
use App\Actions\Wrapped\OpenWrapped;
use App\Enums\ErrorCode;
use App\Exceptions\ApiException;
use App\Http\Controllers\Controller;
use App\Http\Requests\Api\V1\Wrapped\WrappedCardRequest;
use App\Http\Requests\Api\V1\Wrapped\WrappedSeasonRequest;
use App\Http\Resources\V1\WrappedResource;
use App\Http\Resources\V1\WrappedSeasonResource;
use App\Http\Resources\V1\WrappedSharedResource;
use App\Models\User;
use App\Models\Wrapped;
use App\Services\Wrapped\WrappedCardImages;
use Illuminate\Http\Request;
use Illuminate\Http\Resources\Json\AnonymousResourceCollection;
use Illuminate\Http\Response;
use Illuminate\Support\Facades\Gate;

/**
 * M5.9e Season Wrapped (10 §16.5, m5.9e contract §5). Member only, own data only; 404 `feature_disabled` while the flag `wrapped` is off.
 */
class WrappedController extends Controller
{
    /**
     * My Wrapped seasons.
     *
     * The seasons I have a Wrapped of, newest first, each with `released`. `meta.countdown` = `{season_key, release_at}` of the soonest of
     * them that opens within 7 days while the flag `wrapped.countdown` is on, else null.
     */
    public function index(Request $request, ListMyWrapped $list): AnonymousResourceCollection
    {
        Gate::authorize('viewAny', Wrapped::class);

        /** @var User $user */
        $user = $request->user();
        $result = $list($user);
        $countdown = $result['countdown'];

        return WrappedSeasonResource::collection($result['seasons'])->additional(['meta' => [
            /** @var array{season_key: string, release_at: string}|null */
            'countdown' => $countdown === null ? null : ['season_key' => $countdown['season_key'], 'release_at' => $countdown['release_at']->toIso8601String()],
        ]]);
    }

    /**
     * One season's Wrapped.
     *
     * The story payload (cards in order, words in my language). 403 `wrapped_not_released` before the season's release, 404 `not_found`
     * when I have none. The first read sets `viewed_at`.
     */
    public function show(WrappedSeasonRequest $request, OpenWrapped $open): WrappedResource
    {
        /** @var User $user */
        $user = $request->user();

        return new WrappedResource($open($user, $request->seasonKey()));
    }

    /**
     * Count a share.
     *
     * After I opened the share sheet for a card: `shared_count + 1` ("Teilen geöffnet": the OS cannot tell a cancelled share apart). Send an `Idempotency-Key`; a retry with the same key answers the same and counts once.
     * 403 `account_restricted` while I may not publish.
     */
    public function shared(WrappedSeasonRequest $request, MarkWrappedShared $mark): WrappedSharedResource
    {
        /** @var User $user */
        $user = $request->user();

        return new WrappedSharedResource($mark($user, $request->seasonKey()));
    }

    /**
     * A card as an image.
     *
     * PNG, 1080 × 1920, of card `n` (1-based position in `cards`), drawn by the server for the member web's share and download. Mine only;
     * the same release gate as the payload; 404 for a position without a card. `ETag` = the card's content hash.
     */
    public function card(WrappedCardRequest $request, FindMyWrapped $find, WrappedCardImages $images): Response
    {
        /** @var User $user */
        $user = $request->user();
        $wrapped = $find($user, $request->seasonKey());
        $card = $images->png($wrapped, $request->position()) ?? throw new ApiException(ErrorCode::NotFound);
        $etag = '"'.$card['hash'].'"';
        $headers = [
            'Content-Type' => 'image/png',
            'Content-Disposition' => 'inline; filename="speedclub-wrapped-'.$wrapped->season_key.'-'.$request->position().'.png"',
            'Cache-Control' => 'private, no-cache',
            'ETag' => $etag,
        ];

        if (in_array($etag, $request->getETags(), true)) {
            return new Response('', 304, $headers);
        }

        return new Response($card['png'], 200, $headers);
    }
}
