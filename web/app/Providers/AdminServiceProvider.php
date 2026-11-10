<?php

namespace App\Providers;

use App\Http\Middleware\EnsureRecentStaffPassword;
use App\Http\Middleware\EnsureStaffActive;
use App\Http\Middleware\RestrictAdminAccess;
use App\Models\ApprovalRequest;
use App\Models\BrandAsset;
use App\Models\CatalogImport;
use App\Models\Entitlement;
use App\Models\KeywordRule;
use App\Models\KeywordRuleHit;
use App\Models\MembershipPlan;
use App\Models\MessageTemplate;
use App\Models\ModCategorySchemaVersion;
use App\Models\PersonalAccessToken;
use App\Models\PrivacyRequest;
use App\Models\Release;
use App\Models\SorTemplate;
use App\Models\StaffInvitation;
use App\Models\SupportMacro;
use App\Models\User;
use App\Services\Admin\Kpi\ActivityTracker;
use App\Services\Approvals\Approvals;
use App\Services\Approvals\HandlerRegistry;
use App\Support\ViewAs;
use Illuminate\Auth\Events\Authenticated;
use Illuminate\Contracts\Auth\Middleware\AuthenticatesRequests;
use Illuminate\Contracts\Http\Kernel as KernelContract;
use Illuminate\Database\Eloquent\Relations\Relation;
use Illuminate\Foundation\Http\Kernel;
use Illuminate\Http\Request;
use Illuminate\Routing\Router;
use Illuminate\Session\Middleware\StartSession;
use Illuminate\Support\Facades\Event;
use Illuminate\Support\Facades\Route;
use Illuminate\Support\ServiceProvider;
use Laravel\Sanctum\Events\TokenAuthenticated;
use Throwable;

/**
 * The server side of the admin foundation (M3.1 contract §1): the staff middleware, the four-eyes engine, the KPI counters and the
 * staff session routes.
 *
 * Every staff route gets two middleware through the "staff" group, so no module can forget them: RestrictAdminAccess first and ahead
 * of the session (IP allow-list and admin domain, 404), EnsureStaffActive last (status and credentials epoch on every request). They
 * are added to the group here, after bootstrap/app.php has defined it, so the lead's file stays as it is.
 */
class AdminServiceProvider extends ServiceProvider
{
    public function register(): void
    {
        $this->app->singleton(HandlerRegistry::class);
        $this->app->singleton(Approvals::class);
    }

    public function boot(): void
    {
        Relation::morphMap([
            'approval_request' => ApprovalRequest::class,
            // M3.3 admin-only catalogue rows (ADM-15, ADM-17).
            'catalog_import' => CatalogImport::class,
            'mod_category_schema_version' => ModCategorySchemaVersion::class,
            // M3.5 admin-only rows (ADM-28, ADM-33, ADM-38).
            'brand_asset' => BrandAsset::class,
            'message_template' => MessageTemplate::class,
            'release' => Release::class,
            // M3.4 admin-only rows (ADM-23, ADM-24, ADM-27).
            'keyword_rule' => KeywordRule::class, 'keyword_rule_hit' => KeywordRuleHit::class, 'sor_template' => SorTemplate::class, 'support_macro' => SupportMacro::class,
            // M3.6 admin-only rows (ADM-39, ADM-45, ADM-F1/F2).
            'staff_invitation' => StaffInvitation::class, 'privacy_request' => PrivacyRequest::class,
            'membership_plan' => MembershipPlan::class, 'entitlement' => Entitlement::class,
        ]);

        $router = $this->app->make(Router::class);
        $router->aliasMiddleware('staff.active', EnsureStaffActive::class);
        $router->aliasMiddleware('staff.recent-password', EnsureRecentStaffPassword::class);

        $this->callAfterResolving(KernelContract::class, function (Kernel $kernel): void {
            $kernel->prependMiddlewareToGroup('staff', RestrictAdminAccess::class);
            $kernel->appendMiddlewareToGroup('staff', EnsureStaffActive::class);
            $kernel->addToMiddlewarePriorityBefore(StartSession::class, RestrictAdminAccess::class);
            // Ahead of auth:staff, so a guest who lost the session to the idle limit hears so before the redirect to the sign-in.
            $kernel->addToMiddlewarePriorityBefore(AuthenticatesRequests::class, EnsureStaffActive::class);
        });

        if (! $this->app->routesAreCached()) {
            Route::middleware(['web', 'staff'])->prefix('admin')->name('admin.')->group(base_path('routes/staff.php'));
        }

        $this->trackActivity();
    }

    /**
     * ADR-216: last_seen_at and the day/month counters move on authenticated use, not only at sign-in. A token request fires
     * TokenAuthenticated, a member web session fires Authenticated on the session guard. A view-as token (ADM-10) does not count: it
     * is staff looking. Never fails the request: the counters are statistics.
     */
    private function trackActivity(): void
    {
        $track = function (mixed $user): void {
            if (! $user instanceof User || $user->trashed()) {
                return;
            }

            try {
                app(ActivityTracker::class)->seen($user);
            } catch (Throwable $exception) {
                report($exception);
            }
        };

        Event::listen(TokenAuthenticated::class, function (TokenAuthenticated $event) use ($track): void {
            $token = $event->token;

            if ($token instanceof PersonalAccessToken && ! ViewAs::isToken($token)) {
                $track($token->tokenable);
            }
        });

        Event::listen(Authenticated::class, function (Authenticated $event) use ($track): void {
            if ($event->guard === 'web') {
                $track($event->user);
            }
        });
    }
}
