<?php

namespace App\Http\Controllers\Api\V1\Messaging;

use App\Enums\ErrorCode;
use App\Exceptions\ApiException;
use App\Http\Controllers\Controller;
use App\Http\Requests\Api\V1\Messaging\ChannelAuthRequest;
use App\Http\Resources\V1\ChannelAuthResource;
use App\Models\Conversation;
use App\Models\User;
use App\Services\Messaging\ChannelAccess;
use App\Services\Messaging\Realtime;
use Illuminate\Support\Facades\Gate;

/**
 * Pusher private-channel authorisation for token and cookie members (05_ARCHITECTURE §11, m2.4-contract §2).
 */
class BroadcastAuthController extends Controller
{
    /**
     * Authorise a realtime channel.
     *
     * `private-user.{your id}` or `private-conversation.{id}` of a conversation you are in (no block either way); anything else 403.
     * 404 `feature_disabled` while realtime is not set up (the app polls then). Answers `{auth}` without a `data` wrapper, as pusher-js
     * reads it.
     */
    public function __invoke(ChannelAuthRequest $request, ChannelAccess $access, Realtime $realtime): ChannelAuthResource
    {
        /** @var User $member */
        $member = $request->user();
        Gate::authorize('viewAny', Conversation::class);

        if (! Realtime::enabled()) {
            throw new ApiException(ErrorCode::FeatureDisabled, (string) __('errors.realtime_off'));
        }

        $channel = (string) $request->validated('channel_name');

        if (! $access->allows($member, $channel)) {
            throw new ApiException(ErrorCode::Forbidden);
        }

        return new ChannelAuthResource($realtime->sign($channel, (string) $request->validated('socket_id')));
    }
}
