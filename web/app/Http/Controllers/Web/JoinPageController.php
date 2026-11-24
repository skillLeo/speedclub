<?php

namespace App\Http\Controllers\Web;

use App\Http\Controllers\Controller;
use App\Models\User;
use App\Services\Invites\InviteCodes;
use Illuminate\Http\Response;

/**
 * M5.9d WEB-17 /join/{code} (m5.9d contract §5, §10.4): the invite link. The installed app claims the path (PlatformFilesController
 * APP_PATHS) and opens INV-02 with the code; in a browser this page names who invites and hands the code to the member web's sign-up
 * (/app/join/{code}, which keeps it for auth/register and the passwordless sign-up) or to the store page. Sessionless, noindex, never
 * cached. An unknown, used or no longer valid code: 404 with a way to sign up without it.
 */
class JoinPageController extends Controller
{
    public function __invoke(string $code, InviteCodes $invites): Response
    {
        $normal = InviteCodes::normalize($code);
        $invite = $invites->open($normal);
        $inviter = $invite?->inviter;

        $response = response()->view('public.join', [
            'state' => $invite === null ? 'invalid' : 'valid',
            'code' => $invite?->code,
            'inviter' => $inviter instanceof User && $inviter->username !== null
                ? ['username' => $inviter->username, 'display_name' => $inviter->getAttribute('display_name')]
                : null,
        ], $invite === null ? 404 : 200);

        $response->headers->set('Cache-Control', 'no-store');
        $response->headers->set('X-Robots-Tag', 'noindex');

        return $response;
    }
}
