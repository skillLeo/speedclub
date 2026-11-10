<?php

namespace App\Http\Controllers\Api\V1\Me;

use App\Actions\Me\AcceptLegalConsents;
use App\Http\Controllers\Controller;
use App\Http\Requests\Api\V1\Me\AcceptConsentsRequest;
use App\Http\Resources\V1\ConsentStateResource;
use App\Models\User;
use App\Services\Content\Consents;
use Illuminate\Http\Request;
use Illuminate\Support\Facades\Gate;

class ConsentController extends Controller
{
    /**
     * My consent to AGB and Datenschutz.
     *
     * Ask on start when app-config's `legal_reconsent` names a version (and again when it changes): `required` lists what the
     * member must accept before going on.
     */
    public function show(Request $request, Consents $consents): ConsentStateResource
    {
        /** @var User $user */
        $user = $request->user();

        Gate::authorize('update', $user);

        return new ConsentStateResource($consents->state($user));
    }

    /**
     * Accept the current AGB and/or Datenschutz.
     *
     * Send the versions from `required`. A version that is no longer the current one: 422 (reload the sheet).
     */
    public function store(AcceptConsentsRequest $request, AcceptLegalConsents $action, Consents $consents): ConsentStateResource
    {
        /** @var User $user */
        $user = $request->user();

        Gate::authorize('update', $user);

        /** @var array{terms_version?: string|null, privacy_version?: string|null} $input */
        $input = $request->validated();

        return new ConsentStateResource($consents->state($action->handle($user, $input)));
    }
}
