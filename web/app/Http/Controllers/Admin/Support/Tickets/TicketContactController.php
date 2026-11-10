<?php

namespace App\Http\Controllers\Admin\Support\Tickets;

use App\Actions\Admin\Support\RevealTicketContact;
use App\Http\Controllers\Controller;
use App\Models\Staff;
use Illuminate\Http\JsonResponse;
use Illuminate\Http\Request;

/**
 * ADM-26 "Anzeigen" of a web contact's address (DQ-563, support.view): JSON only, so the address never sits in a prop, flash or the
 * session; audited per opening (RevealTicketContact).
 */
class TicketContactController extends Controller
{
    public function __invoke(Request $request, string $ticket, RevealTicketContact $reveal): JsonResponse
    {
        abort_if($request->header('X-Inertia') !== null, 409);
        /** @var Staff $staff */
        $staff = $request->user('staff');

        return response()->json($reveal->handle($staff, TicketShowController::find($ticket)), 200, ['Cache-Control' => 'no-store, private']);
    }
}
