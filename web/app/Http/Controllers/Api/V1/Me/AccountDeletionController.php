<?php

namespace App\Http\Controllers\Api\V1\Me;

use App\Actions\Account\DeleteAccount;
use App\Http\Controllers\Controller;
use App\Http\Requests\Api\V1\Me\DeleteAccountRequest;
use App\Models\PersonalAccessToken;
use App\Models\User;
use App\Services\Auth\Reauthentication;
use Illuminate\Http\Response;
use Illuminate\Support\Facades\Auth;
use Illuminate\Support\Facades\Gate;

class AccountDeletionController extends Controller
{
    /**
     * Delete my account (SET-13).
     *
     * Needs the `password` and, with two-factor on, `code` (authenticator or recovery code); wrong or missing: 422 on the field. Closes
     * the account at once: profile and vehicles disappear everywhere, QR stickers stop working, every device is signed out, follows
     * end. Messages stay for the other side as "Gelöschtes Mitglied". Everything is deleted for good within 30 days; there is no way back,
     * and signing in answers as for an unknown account. Open under every restriction. The same deletion as /konto-loeschen (WEB-05).
     */
    public function store(DeleteAccountRequest $request, Reauthentication $reauth, DeleteAccount $action): Response
    {
        /** @var User $user */
        $user = $request->user();

        Gate::authorize('delete', $user);

        $reauth->password($user, $request->string('password')->toString());

        $code = $request->validated('code');
        $reauth->secondFactor($user, is_string($code) ? $code : null);

        $action->handle($user);

        // The rows are gone already; this ends the cookie of this browser as well.
        if (! $user->currentAccessToken() instanceof PersonalAccessToken && $request->hasSession()) {
            Auth::guard('web')->logout();
            $request->session()->invalidate();
            $request->session()->regenerateToken();
        }

        return response()->noContent();
    }
}
