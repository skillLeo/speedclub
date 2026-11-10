<?php

namespace App\Http\Controllers\Api\V1\Auth;

use App\Actions\Auth\RegisterMember;
use App\Http\Controllers\Controller;
use App\Http\Requests\Api\V1\Auth\RegisterRequest;
use App\Http\Resources\V1\NextStepResource;

class RegistrationController extends Controller
{
    /**
     * Create an account.
     *
     * The same 202 whether or not the address has an account, so nobody can probe addresses. A new address gets a
     * verification code, a known one a notice with sign-in and reset links. Issues no auth; that happens at
     * auth/email/verify. Password errors in 422 name the broken rule. `ref` names where sign-up began (a QR scan or a public page), for
     * the admin's sign-up counts; nothing else about the scan or the page is stored.
     *
     * @unauthenticated
     */
    public function store(RegisterRequest $request, RegisterMember $action): NextStepResource
    {
        /** @var array{email: string, password: string, marketing_consent?: bool|null, locale?: string|null, ref?: string|null} $input */
        $input = $request->safe()->only(['email', 'password', 'marketing_consent', 'locale', 'ref']);

        /** @status 202 */
        return new NextStepResource($action->handle($input));
    }
}
