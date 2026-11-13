<?php

namespace App\Http\Controllers\Api\V1\Security;

use App\Actions\Security\SecureAccount;
use App\Enums\ErrorCode;
use App\Enums\SecurityActivity;
use App\Enums\SocialProvider;
use App\Exceptions\ApiException;
use App\Http\Controllers\Controller;
use App\Http\Requests\Api\V1\Security\SecureAccountRequest;
use App\Http\Requests\Api\V1\Security\SecurityEventsRequest;
use App\Http\Resources\V1\SecuredAccountResource;
use App\Http\Resources\V1\SecurityEventResource;
use App\Http\Resources\V1\SignInMethodsResource;
use App\Models\SecurityEvent;
use App\Models\User;
use App\Services\AppConfig\FeatureFlags;
use App\Services\Auth\SignInMethods;
use App\Support\Security\SignInMethodsSummary;
use Illuminate\Http\Request;
use Illuminate\Http\Resources\Json\AnonymousResourceCollection;
use Illuminate\Support\Facades\Gate;

class SecurityActivityController extends Controller
{
    /**
     * Security activity (SET-21).
     *
     * The member's own security events, newest first, cursor-paged: sign-ins (with method and device), sign-ins on a new device,
     * failed attempts as one row per day with counts, locks, password, e-mail and two-factor changes, passkeys and providers added or
     * removed, devices signed out, "Das war ich nicht". Kept 12 months. No IP address; a place only as an approximate city (OA-33).
     */
    public function index(SecurityEventsRequest $request): AnonymousResourceCollection
    {
        $user = $this->member($request);

        Gate::authorize('update', $user);

        return SecurityEventResource::collection(
            $user->securityEvents()
                // SecurityEvent::scopeShown, written out so the OpenAPI export keeps the cursor page (meta.next_cursor) typed.
                ->whereIn('type', SecurityActivity::shownEvents())
                ->orderByDesc('created_at')
                ->orderByDesc('id')
                ->cursorPaginate($request->pageSize())
                ->withQueryString()
        );
    }

    /**
     * "Das war ich nicht" (SET-21).
     *
     * Secures the account at once: every device and browser is signed out, this one too (sign in again), an account with a password
     * must set a new one by e-mail code at the next sign-in, and a support request is opened (`ticket_reference`). `security_event_id`
     * names the row that was not the member; another member's id: 404. No recent authentication: the owner must be able to act fast.
     */
    public function secure(SecureAccountRequest $request, SecureAccount $action): SecuredAccountResource
    {
        $user = $this->member($request);

        Gate::authorize('update', $user);

        $id = $request->validated('security_event_id');
        $event = null;

        if (is_string($id)) {
            $event = $user->securityEvents()->whereKey($id)->first() ?? throw new ApiException(ErrorCode::NotFound);
            Gate::authorize('view', $event);
        }

        return new SecuredAccountResource($action->handle($user, $event instanceof SecurityEvent ? $event : null, 'app'));
    }

    /**
     * Sign-in methods (SET-19).
     *
     * Every way into the account: the e-mail code (always), the password, two-factor, Apple and Google, the number of passkeys.
     */
    public function methods(Request $request, SignInMethods $methods, FeatureFlags $flags): SignInMethodsResource
    {
        $user = $this->member($request);

        Gate::authorize('update', $user);

        $keys = ['auth.password_login', 'auth.passkeys', ...array_map(fn (SocialProvider $provider): string => $provider->flag(), SocialProvider::cases())];

        return new SignInMethodsResource(new SignInMethodsSummary(
            $user,
            $methods->mailboxReachable($user),
            $user->socialAccounts()->get(),
            $user->memberPasskeys()->count(),
            array_combine($keys, array_map(fn (string $key): bool => $flags->enabled($key), $keys)),
        ));
    }

    private function member(Request $request): User
    {
        /** @var User $user */
        $user = $request->user();

        return $user;
    }
}
