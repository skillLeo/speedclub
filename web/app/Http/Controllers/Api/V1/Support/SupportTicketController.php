<?php

namespace App\Http\Controllers\Api\V1\Support;

use App\Actions\Support\AddMemberReply;
use App\Actions\Support\CreateSupportTicket;
use App\Enums\ErrorCode;
use App\Enums\SupportCategory;
use App\Exceptions\ApiException;
use App\Http\Controllers\Controller;
use App\Http\Requests\Api\V1\Support\StoreSupportTicketRequest;
use App\Http\Requests\Api\V1\Support\StoreTicketMessageRequest;
use App\Http\Resources\V1\SupportTicketReplyResource;
use App\Http\Resources\V1\SupportTicketResource;
use App\Http\Resources\V1\SupportTicketThreadResource;
use App\Models\SupportTicket;
use App\Models\User;
use Illuminate\Http\Request;
use Illuminate\Http\Resources\Json\AnonymousResourceCollection;
use Illuminate\Support\Facades\Gate;

class SupportTicketController extends Controller
{
    /**
     * My support requests (SET-15).
     *
     * The member's tickets, latest activity first (at most 50), each with its status: `open`, `pending` (the team answered and waits for
     * the member) or `closed`. Open to unverified and restricted members.
     *
     * @return AnonymousResourceCollection<SupportTicketResource>
     */
    public function index(Request $request): AnonymousResourceCollection
    {
        /** @var User $user */
        $user = $request->user();
        abort_if($user->isDeactivated(), 403);

        $tickets = SupportTicket::query()->where('user_id', $user->id)
            ->orderByRaw('COALESCE(last_activity_at, updated_at) desc')->orderByDesc('id')->limit(50)->get();

        return SupportTicketResource::collection($tickets);
    }

    /**
     * One support request with its thread (SET-15).
     *
     * The member's messages and the team's replies (M3.4, ADM-26), oldest first; the team's internal notes are never part of it. 404 for
     * another member's ticket.
     */
    public function show(Request $request, string $ticket): SupportTicketThreadResource
    {
        /** @var User $user */
        $user = $request->user();
        $row = SupportTicket::query()->where('user_id', $user->id)->whereKey(strtolower($ticket))->first();

        if (! $row instanceof SupportTicket || ! Gate::forUser($user)->allows('view', $row)) {
            throw new ApiException(ErrorCode::NotFound);
        }

        return new SupportTicketThreadResource($row);
    }

    /**
     * Write to support (SET-15).
     *
     * Creates a ticket for the team (ADM-25) and mails a receipt with its reference to the account's address. Open to unverified and
     * restricted members. Accepts an `Idempotency-Key`; 5 an hour.
     */
    public function store(StoreSupportTicketRequest $request, CreateSupportTicket $action): SupportTicketResource
    {
        /** @var User $user */
        $user = $request->user();

        Gate::authorize('create', SupportTicket::class);

        $ticket = $action->forMember(
            $user,
            SupportCategory::from($request->string('category')->toString()),
            trim($request->string('subject')->toString()),
            trim($request->string('message')->toString()),
        );

        /** @status 201 */
        return new SupportTicketResource($ticket);
    }

    /**
     * Write again in a support request (SET-15b).
     *
     * Adds the member's message to their own ticket's thread and hands it back to the team: the status becomes `open`, also for a
     * `closed` or `pending` ticket. Answers the thread as `GET support/tickets/{ticket}` does. 404 for another member's ticket or a web
     * contact's; 403 for a closed account. Open to unverified and restricted members. Accepts an `Idempotency-Key`; counts against
     * the same 5 an hour as a new request.
     */
    public function reply(StoreTicketMessageRequest $request, string $ticket, AddMemberReply $action): SupportTicketReplyResource
    {
        /** @var User $user */
        $user = $request->user();

        // A closed account: 403, as for a new request; somebody else's ticket: 404.
        Gate::authorize('create', SupportTicket::class);
        $row = SupportTicket::query()->where('user_id', $user->id)->whereKey(strtolower($ticket))->first();

        if (! $row instanceof SupportTicket || ! Gate::forUser($user)->allows('reply', $row)) {
            throw new ApiException(ErrorCode::NotFound);
        }

        $updated = $action->handle($user, $row, $request->string('message')->toString());

        /** @status 201 */
        return new SupportTicketReplyResource($updated);
    }
}
