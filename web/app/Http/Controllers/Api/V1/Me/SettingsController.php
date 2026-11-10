<?php

namespace App\Http\Controllers\Api\V1\Me;

use App\Actions\Me\UpdateSettings;
use App\Http\Controllers\Controller;
use App\Http\Requests\Api\V1\Me\UpdateSettingsRequest;
use App\Http\Resources\V1\MemberSettingsResource;
use App\Models\User;
use Illuminate\Http\Request;
use Illuminate\Support\Facades\Gate;

class SettingsController extends Controller
{
    /**
     * My settings.
     */
    public function show(Request $request): MemberSettingsResource
    {
        /** @var User $user */
        $user = $request->user();

        Gate::authorize('update', $user);

        return new MemberSettingsResource($user);
    }

    /**
     * Update app, privacy and notification settings.
     *
     * Any subset of: theme, locale, power_display, show_owner_on_qr, who_can_message, discoverable, indexable, read_receipts,
     * ai_suggestions, notification_prefs. indexable false takes the profile and the builds out of the sitemap at once and marks the pages noindex.
     */
    public function update(UpdateSettingsRequest $request, UpdateSettings $action): MemberSettingsResource
    {
        /** @var User $user */
        $user = $request->user();

        Gate::authorize('update', $user);

        return new MemberSettingsResource($action->handle($user, $request->validated()));
    }
}
