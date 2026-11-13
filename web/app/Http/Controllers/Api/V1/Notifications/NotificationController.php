<?php

namespace App\Http\Controllers\Api\V1\Notifications;

use App\Actions\Notifications\MarkAllNotificationsRead;
use App\Actions\Notifications\MarkNotificationRead;
use App\Enums\ErrorCode;
use App\Exceptions\ApiException;
use App\Http\Controllers\Controller;
use App\Http\Requests\Api\V1\Notifications\NotificationListRequest;
use App\Http\Requests\Api\V1\Notifications\UpdateNotificationRequest;
use App\Http\Resources\V1\NotificationResource;
use App\Http\Resources\V1\UnreadCountResource;
use App\Models\Notification;
use App\Models\User;
use App\Services\Messaging\MessagingCounts;
use App\Services\Notifications\NotificationFeed;
use App\Services\Notifications\UnreadCounts;
use Illuminate\Http\Request;
use Illuminate\Http\Resources\Json\AnonymousResourceCollection;
use Illuminate\Http\Response;
use Illuminate\Support\Facades\Gate;

/**
 * HOME-02 and the badges (M2.2, 02_PRODUCT_SPEC §7).
 */
class NotificationController extends Controller
{
    public function __construct(private readonly NotificationFeed $feed) {}

    /**
     * List my notifications.
     *
     * Newest first; a grouped row counts once, with its newest actors. Rows about a member the reader may no longer see are left out.
     */
    public function index(NotificationListRequest $request): AnonymousResourceCollection
    {
        $member = $this->member($request);
        Gate::authorize('viewAny', Notification::class);

        $category = $request->validated('category');

        return NotificationResource::collection($this->feed->page($member, $request->pageSize(), is_string($category) ? $category : null));
    }

    /**
     * Count what is unread.
     *
     * For the bell and the tab badges; the app asks on focus and every 60 s in the foreground (every 15 s with the inbox open).
     * `messages`: unread messages in Chats that are not muted; `requests`: open message requests.
     */
    public function unreadCount(Request $request, MessagingCounts $messaging): UnreadCountResource
    {
        $member = $this->member($request);
        Gate::authorize('viewAny', Notification::class);
        $counts = $messaging->for($member);

        return new UnreadCountResource(new UnreadCounts($this->feed->unreadCount($member), $counts['messages'], $counts['requests']));
    }

    /**
     * Mark one notification read or unread.
     */
    public function update(UpdateNotificationRequest $request, string $notification, MarkNotificationRead $action): NotificationResource
    {
        $member = $this->member($request);
        Gate::authorize('viewAny', Notification::class);
        // Another member's row and one the list leaves out are the same 404 as an id that never existed.
        $row = $this->feed->find($member, $notification) ?? throw new ApiException(ErrorCode::NotFound);
        Gate::authorize('update', $row);

        return new NotificationResource($action->handle($row, $request->boolean('read')));
    }

    /**
     * Mark all notifications read.
     */
    public function readAll(Request $request, MarkAllNotificationsRead $action): Response
    {
        $member = $this->member($request);
        Gate::authorize('viewAny', Notification::class);

        $action->handle($member);

        return response()->noContent();
    }

    private function member(Request $request): User
    {
        /** @var User $member */
        $member = $request->user();

        return $member;
    }
}
