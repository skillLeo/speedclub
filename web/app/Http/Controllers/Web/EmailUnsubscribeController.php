<?php

namespace App\Http\Controllers\Web;

use App\Actions\Engagement\UnsubscribeFromRecap;
use App\Actions\Events\UnsubscribeNearbyEmail;
use App\Http\Controllers\Controller;
use App\Models\User;
use App\Services\Notifications\NotificationTexts;
use Illuminate\Http\Request;
use Illuminate\Support\Facades\URL;
use Symfony\Component\HttpFoundation\Response;

/**
 * WEB-UNSUB /abbestellen/{list}/{member} (M5.6, m5.6-contract §6): the unsubscribe page of an e-mail the member opted into. Sessionless
 * like every public page. The link is signed (and expires), so it names the member without a sign-in and cannot be built for somebody
 * else; a changed or expired link shows "Link nicht mehr gültig" (403).
 *
 * GET only asks: mail scanners and link previews open links, and opening must change nothing. POST changes the setting: the page's button,
 * and the mail client's RFC 8058 one-click (`List-Unsubscribe-Post: List-Unsubscribe=One-Click`) to the same signed URL. Idempotent. Each
 * list switches off exactly its own e-mail; LISTS maps the path segment to the action (the Engagement lane adds its weekly recap here).
 */
class EmailUnsubscribeController extends Controller
{
    /** list => action with handle(User): void */
    public const LISTS = [
        'treffen' => UnsubscribeNearbyEmail::class,
        // M5.7 (m5.7-contract §6.5): the weekly recap e-mail.
        'wochenrueckblick' => UnsubscribeFromRecap::class,
    ];

    /**
     * The signed link of $list for $member, valid $days days, in the member's language.
     */
    public static function url(string $list, User $member, int $days): string
    {
        return URL::temporarySignedRoute('email.unsubscribe', now()->addDays($days), [
            'list' => $list,
            'member' => $member->id,
            'lang' => app(NotificationTexts::class)->locale($member),
        ]);
    }

    public function __invoke(Request $request, string $list, string $member): Response
    {
        $action = self::LISTS[$list] ?? null;

        if ($action === null) {
            abort(404);
        }

        if (! URL::hasValidSignature($request)) {
            return response()->view('public.email-unsubscribe', ['list' => $list, 'step' => 'gone', 'action' => null], 403)
                ->header('Cache-Control', 'no-store');
        }

        if ($request->isMethod('post')) {
            $user = User::query()->find(mb_strtolower($member));

            if ($user instanceof User) {
                app($action)->handle($user);
            }
        }

        return response()->view('public.email-unsubscribe', [
            'list' => $list,
            'step' => $request->isMethod('post') ? 'done' : 'ask',
            'action' => $request->fullUrl(),
        ])->header('Cache-Control', 'no-store')->header('X-Robots-Tag', 'noindex');
    }
}
