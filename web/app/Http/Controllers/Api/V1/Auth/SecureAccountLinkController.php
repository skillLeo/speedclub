<?php

namespace App\Http\Controllers\Api\V1\Auth;

use App\Actions\Security\SecureAccount;
use App\Http\Controllers\Controller;
use App\Http\Requests\Api\V1\Auth\SecureAccountLinkRequest;
use App\Http\Resources\V1\SecuredAccountResource;
use App\Models\User;
use App\Services\Security\SecureAccountLinks;

class SecureAccountLinkController extends Controller
{
    /**
     * "Das war ich nicht" from a login alert (09 §8.4).
     *
     * `token` is the fragment of /auth/secure#t=… in the alert mail; no sign-in needed (the owner may be locked out). Secures the account
     * as SET-21 does: every device signed out, a new password by e-mail code at the next sign-in when the account has one, a support
     * request opened, and ways in added since the reported sign-in removed (`removed`). The link works once and for 7 days; only securing the
     * account (by any link or SET-21) and deleting it end it early. Invalid, used or expired: 422 on `token`.
     *
     * @unauthenticated
     */
    public function store(SecureAccountLinkRequest $request, SecureAccountLinks $links, SecureAccount $action): SecuredAccountResource
    {
        $event = $links->resolve($request->string('token')->toString());
        $user = $event?->user;

        if ($event === null || ! $user instanceof User || $user->trashed()) {
            throw SecureAccountLinks::invalid();
        }

        return new SecuredAccountResource($action->handle($user, $event, 'link'));
    }
}
