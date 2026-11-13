<?php

namespace App\Http\Controllers\Api\V1\Security;

use App\Actions\Security\AcceptOnboardingTerms;
use App\Http\Controllers\Controller;
use App\Http\Requests\Api\V1\Security\AcceptOnboardingRequest;
use App\Http\Resources\V1\MeResource;
use App\Models\User;
use Illuminate\Support\Facades\Gate;

class OnboardingController extends Controller
{
    /**
     * Accept AGB, Datenschutz and the age line (AUTH-09b).
     *
     * For a new passwordless account (`next_step: accept_terms`); until then every write but security setup answers 403 `terms_required`.
     * The versions must be the ones published now (app-config `legal`), else 422 on the field. Already accepted: 409 `conflict`.
     */
    public function accept(AcceptOnboardingRequest $request, AcceptOnboardingTerms $action): MeResource
    {
        /** @var User $user */
        $user = $request->user();

        Gate::authorize('update', $user);

        return new MeResource($action->handle($user, $request->string('terms_version')->toString(), $request->string('privacy_version')->toString()));
    }
}
