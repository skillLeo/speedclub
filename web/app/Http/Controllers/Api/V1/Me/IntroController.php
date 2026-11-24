<?php

namespace App\Http\Controllers\Api\V1\Me;

use App\Actions\Me\MarkIntroSeen;
use App\Http\Controllers\Controller;
use App\Models\User;
use Illuminate\Http\Request;
use Illuminate\Http\Response;
use Illuminate\Support\Facades\Gate;

class IntroController extends Controller
{
    /**
     * Mark the introduction as seen.
     *
     * R4-1.4 (INTRO-01…04): after the last page or "Überspringen". Once per account; repeating it is harmless (204 again). Open under
     * every restriction, as it is not public content.
     */
    public function seen(Request $request, MarkIntroSeen $action): Response
    {
        /** @var User $user */
        $user = $request->user();

        Gate::authorize('update', $user);

        $action->handle($user);

        return response()->noContent();
    }
}
