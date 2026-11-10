<?php

namespace App\Support;

use App\Enums\PowerDisplay;
use App\Models\User;
use Illuminate\Http\Request;

/**
 * Who reads a public route. These routes take guests, so nothing rejects a token there: an invalid one counts as a guest, and
 * so does a member who must replace the password (ADR-137), since that member has no authenticated route at all.
 */
final class Viewer
{
    private const REQUEST_ATTRIBUTE = 'speedclub.viewer';

    /**
     * Once per request, the answer "nobody" included: the guard does not remember a null user, so an invalid token would otherwise
     * ask the database again for every row of a resource.
     */
    public static function from(Request $request): ?User
    {
        $attributes = $request->attributes;

        if ($attributes->has(self::REQUEST_ATTRIBUTE)) {
            $viewer = $attributes->get(self::REQUEST_ATTRIBUTE);

            return $viewer instanceof User ? $viewer : null;
        }

        $user = $request->user('sanctum');
        $viewer = $user instanceof User && $user->getAttribute('force_password_change') !== true ? $user : null;

        $attributes->set(self::REQUEST_ATTRIBUTE, $viewer);

        return $viewer;
    }

    /**
     * For the rest of this request the reader counts as a guest, whatever token came with it.
     */
    public static function treatAsGuest(Request $request): void
    {
        $request->attributes->set(self::REQUEST_ATTRIBUTE, null);
    }

    /**
     * The viewer's setting, for guests the default "510 PS (375 kW)" (02_PRODUCT_SPEC §3.2).
     */
    public static function powerDisplay(?User $viewer): PowerDisplay
    {
        $display = $viewer?->getAttribute('power_display');

        return $display instanceof PowerDisplay ? $display : PowerDisplay::PsKw;
    }
}
