<?php

namespace App\Http\Controllers\Admin\Support\Tickets;

use App\Actions\Admin\Support\AddTicketNote;
use App\Actions\Admin\Support\ReplyToTicket;
use App\Actions\Admin\Support\UpdateTicket;
use App\Enums\SupportTicketStatus;
use App\Http\Controllers\Admin\Support\Tickets\Requests\TicketReplyRequest;
use App\Http\Controllers\Admin\Support\Tickets\Requests\TicketUpdateRequest;
use App\Http\Controllers\Controller;
use App\Models\Staff;
use Illuminate\Http\RedirectResponse;

/** ADM-25/26 writes (`support.reply`): reply, internal note, status and assignment. */
class TicketActionsController extends Controller
{
    public function reply(TicketReplyRequest $request, string $ticket, ReplyToTicket $reply): RedirectResponse
    {
        $status = SupportTicketStatus::tryFrom($request->string('status')->value()) ?? SupportTicketStatus::Pending;
        $reply->handle(self::staff($request), TicketShowController::find($ticket), $request->string('body')->value(), $status);

        return back(303)->with('success', 'support.flash.replied');
    }

    public function note(TicketReplyRequest $request, string $ticket, AddTicketNote $note): RedirectResponse
    {
        $note->handle(self::staff($request), TicketShowController::find($ticket), $request->string('body')->value());

        return back(303)->with('success', 'support.flash.noted');
    }

    public function update(TicketUpdateRequest $request, string $ticket, UpdateTicket $update): RedirectResponse
    {
        $to = $request->filled('staff_id') ? Staff::query()->find($request->integer('staff_id')) : null;
        abort_if($request->filled('staff_id') && $to === null, 422);

        $update->handle(
            self::staff($request),
            TicketShowController::find($ticket),
            $request->has('staff_id'),
            $to,
            $request->has('status') ? SupportTicketStatus::from($request->string('status')->value()) : null,
        );

        return back(303)->with('success', 'support.flash.updated');
    }

    private static function staff(TicketReplyRequest|TicketUpdateRequest $request): Staff
    {
        /** @var Staff $staff */
        $staff = $request->user('staff');

        return $staff;
    }
}
