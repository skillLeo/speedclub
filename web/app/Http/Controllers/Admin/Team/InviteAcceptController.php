<?php

namespace App\Http\Controllers\Admin\Team;

use App\Actions\Admin\Team\AcceptStaffInvite;
use App\Http\Controllers\Controller;
use App\Services\Team\TeamRefused;
use Illuminate\Http\RedirectResponse;
use Illuminate\Http\Request;
use Inertia\Inertia;
use Inertia\Response;

/**
 * The invite link's guest page (m3.6 §1, ADR-218/237): /admin/invite#token=…; the token never reaches the server with the GET, the page
 * reads it from the fragment and posts it with the new password (the staff password rules). Then the sign-in page; after signing in the
 * account is held at TOTP enrolment (ADM-03). The POST is rate-limited on the route (per client).
 */
class InviteAcceptController extends Controller
{
    public function show(): Response
    {
        return Inertia::render('Auth/AcceptInvite', ['passwordMinLength' => config()->integer('speedclub.passwords.min_length')]);
    }

    public function store(Request $request, AcceptStaffInvite $accept): RedirectResponse
    {
        $token = $request->input('token');

        try {
            $accept->handle(is_string($token) ? $token : '', $request->only(['password', 'password_confirmation']));
        } catch (TeamRefused $refused) {
            return back(303)->withErrors(['token' => $refused->getMessage()]);
        }

        return redirect()->route('login')->with('status', 'team.invite.accepted');
    }
}
