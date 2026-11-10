<?php

namespace App\Http\Controllers\Api\V1\ViewAs;

use App\Actions\Admin\Members\EndViewAs;
use App\Enums\ErrorCode;
use App\Exceptions\ApiException;
use App\Http\Controllers\Controller;
use App\Models\PersonalAccessToken;
use App\Models\User;
use App\Support\ViewAs;
use Illuminate\Http\Request;
use Illuminate\Http\Response;

class ViewAsController extends Controller
{
    /**
     * End a view-as.
     *
     * The admin's read-only "Ansicht als" tab (ADM-10) signs itself out: the view-as token is revoked and the end is audited. The only
     * write a view-as token may make. Any other token: 403 `forbidden`.
     */
    public function destroy(Request $request, EndViewAs $end): Response
    {
        $user = $request->user();
        $token = $user instanceof User ? $user->currentAccessToken() : null;

        if (! $user instanceof User || ! $token instanceof PersonalAccessToken || ! ViewAs::isToken($token)) {
            throw new ApiException(ErrorCode::Forbidden);
        }

        $end->handle($user, $token);

        return response()->noContent();
    }
}
