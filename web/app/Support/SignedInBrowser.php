<?php

namespace App\Support;

use App\Models\User;
use Illuminate\Http\Request;
use Illuminate\Session\SessionManager;
use Illuminate\Session\Store;
use Illuminate\Support\Facades\Auth;
use Throwable;

/**
 * Who a browser on a public Blade page is signed in as, without starting a session (ADR-115). Only a request that already carries the
 * session cookie gets any further, so a guest costs no query and gets no cookie. The session is read from a copy of the
 * store, which nothing ever saves: no write, no Set-Cookie, no change to last_activity.
 *
 * A cookie alone proves nothing. /sanctum/csrf-cookie gives one to a browser before it signs in, and a stale one outlives its session.
 * Both read as guests here, and that is why this reads the session instead of only checking that the cookie exists.
 */
final class SignedInBrowser
{
    private const REQUEST_ATTRIBUTE = 'speedclub.signed_in_browser';

    public static function member(Request $request): ?User
    {
        $attributes = $request->attributes;

        if ($attributes->has(self::REQUEST_ATTRIBUTE)) {
            $member = $attributes->get(self::REQUEST_ATTRIBUTE);

            return $member instanceof User ? $member : null;
        }

        $member = self::read($request);
        $attributes->set(self::REQUEST_ATTRIBUTE, $member);

        return $member;
    }

    /**
     * A block in either direction between the browser's member and $other (02_PRODUCT_SPEC §3.5). The public pages show a signed-in
     * browser what a guest gets when it reaches them at all (?view=public, or while redirect_members_to_app is off), but a block
     * still holds there: the blocked side gets the same 404 as for a page that does not exist. A guest costs no query.
     */
    public static function hasBlockWith(Request $request, ?User $other): bool
    {
        $member = self::member($request);

        return $member !== null && $other !== null && ! $member->is($other) && $member->hasBlockWith($other);
    }

    /**
     * A public page must keep working when the session store does not, so any failure here means "guest".
     */
    private static function read(Request $request): ?User
    {
        $sessionId = $request->cookies->get(config()->string('session.cookie'));

        if (! is_string($sessionId) || $sessionId === '') {
            return null;
        }

        try {
            /** @var SessionManager $sessions */
            $sessions = app('session');
            $driver = $sessions->driver();

            if (! $driver instanceof Store) {
                return null;
            }

            $store = clone $driver;
            $store->setId($sessionId);
            $store->start();

            $id = $store->get(Auth::guard('web')->getName());

            return is_string($id) ? User::query()->find($id) : null;
        } catch (Throwable $exception) {
            report($exception);

            return null;
        }
    }
}
