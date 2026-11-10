<?php

namespace App\Providers;

use App\Exceptions\QueryExceptionReporter;
use App\Http\Middleware\EnsurePasswordCurrent;
use App\Models\Appeal;
use App\Models\AuditEvent;
use App\Models\Block;
use App\Models\Brand;
use App\Models\BuildUpdate;
use App\Models\CatalogRequest;
use App\Models\ConfigVersion;
use App\Models\Conversation;
use App\Models\ConversationParticipant;
use App\Models\DataExport;
use App\Models\Decision;
use App\Models\DiscoverCollection;
use App\Models\FeatureFlag;
use App\Models\Follow;
use App\Models\Generation;
use App\Models\HelpArticle;
use App\Models\IdempotencyKey;
use App\Models\KnownDevice;
use App\Models\LegalDocument;
use App\Models\Make;
use App\Models\Media;
use App\Models\Message;
use App\Models\MessageReactionRow;
use App\Models\ModCategory;
use App\Models\ModCategoryField;
use App\Models\ModerationCase;
use App\Models\Modification;
use App\Models\Notification;
use App\Models\Permission;
use App\Models\PersonalAccessToken;
use App\Models\PushToken;
use App\Models\QrCode;
use App\Models\QrScanDaily;
use App\Models\Report;
use App\Models\Role;
use App\Models\Save;
use App\Models\Staff;
use App\Models\SupportTicket;
use App\Models\TicketMessage;
use App\Models\User;
use App\Models\Vehicle;
use App\Models\VehicleModel;
use App\Models\VehicleSearch;
use App\Models\VehicleSpec;
use App\Models\VerificationCode;
use App\Support\Cache\LosslessRateLimiter;
use App\Support\Cache\RetryingDatabaseStore;
use App\Support\DevMail\RecordDevMail;
use App\Support\Queue\ScrubbingFailedJobProvider;
use App\Support\Session\NoIpDatabaseSessionHandler;
use Illuminate\Cache\RateLimiter;
use Illuminate\Contracts\Auth\Authenticatable;
use Illuminate\Contracts\Debug\ExceptionHandler;
use Illuminate\Contracts\Foundation\Application;
use Illuminate\Database\Eloquent\Relations\Relation;
use Illuminate\Foundation\Exceptions\Handler;
use Illuminate\Mail\Events\MessageSent;
use Illuminate\Queue\Failed\FailedJobProviderInterface;
use Illuminate\Support\Facades\Cache;
use Illuminate\Support\Facades\Event;
use Illuminate\Support\Facades\Gate;
use Illuminate\Support\Facades\Route;
use Illuminate\Support\Facades\Session;
use Illuminate\Support\ServiceProvider;
use Laravel\Sanctum\Sanctum;
use Throwable;

class AppServiceProvider extends ServiceProvider
{
    public function register(): void
    {
        // The database cache store, rate limiter included, retries deadlock victims (config/cache.php). Registered in
        // booting(), as other providers may read the cache in their boot().
        $this->app->booting(function (): void {
            Cache::extend('database-retrying', fn (Application $app, array $config) => RetryingDatabaseStore::driver($app, $config));
        });

        // Every throttle:… and RateLimiter::hit() counts each hit on the database store, also under concurrency.
        $this->app->extend(RateLimiter::class, fn (RateLimiter $limiter): RateLimiter => LosslessRateLimiter::from($limiter));

        // failed_jobs.exception keeps the class, the code, the SQL with placeholders and the frames, never a message (BL-2, ADR-125).
        $this->app->extend('queue.failer', fn (FailedJobProviderInterface $failer): FailedJobProviderInterface => $failer instanceof ScrubbingFailedJobProvider ? $failer : new ScrubbingFailedJobProvider($failer));
    }

    public function boot(): void
    {
        // Browser sessions keep no IP address (ADR-113, M2.5 fix round); the user agent stays for SET-06.
        Session::extend('database', function (Application $app): NoIpDatabaseSessionHandler {
            $connection = config('session.connection');

            return new NoIpDatabaseSessionHandler(
                $app->make('db')->connection(is_string($connection) ? $connection : null),
                config()->string('session.table'),
                config()->integer('session.lifetime'),
                $app,
            );
        });

        // BL-2 (M2.8): an exception caused by a query error is logged like the query error, without the database's message
        // (QueryExceptionReporter). bootstrap/app.php reports a QueryException itself; this covers one further down the chain.
        $this->callAfterResolving(ExceptionHandler::class, function (ExceptionHandler $handler): void {
            if ($handler instanceof Handler) {
                $handler->reportable(fn (Throwable $exception): ?bool => (new QueryExceptionReporter)->report($exception));
            }
        });

        // Stack traces in logs show the start of string arguments otherwise, whatever the host's php.ini says (SEC-106).
        if (! $this->app->environment(['local', 'testing'])) {
            ini_set('zend.exception_ignore_args', '1');
        }

        // Scramble UI at /docs/api: local and staging only (05_ARCHITECTURE §4).
        Gate::define('viewApiDocs', fn (?Authenticatable $user = null): bool => $this->app->environment(['local', 'staging']));

        // Local mail preview. Lives outside app/Listeners, so event discovery can never register it in production.
        /** @var list<string> $previewEnvironments */
        $previewEnvironments = config()->array('speedclub.dev_mail.environments');

        if ($this->app->environment($previewEnvironments)) {
            Event::listen(MessageSent::class, RecordDevMail::class);
        }

        Sanctum::usePersonalAccessTokenModel(PersonalAccessToken::class);

        // What every authenticated member route uses instead of plain auth:sanctum (ADR-137).
        Route::middlewareGroup('member', ['auth:sanctum', EnsurePasswordCurrent::class]);

        // Stable names in polymorphic columns (media, tokens, audit, notifications, spatie roles) instead of
        // class names. Enforced: a new model must be added here before it is used in a morph relation.
        Relation::enforceMorphMap([
            'appeal' => Appeal::class,
            'audit_event' => AuditEvent::class,
            'block' => Block::class,
            'brand' => Brand::class,
            'build_update' => BuildUpdate::class,
            'catalog_request' => CatalogRequest::class,
            'config_version' => ConfigVersion::class,
            'conversation' => Conversation::class,
            'conversation_participant' => ConversationParticipant::class,
            'decision' => Decision::class,
            'data_export' => DataExport::class,
            'discover_collection' => DiscoverCollection::class,
            'feature_flag' => FeatureFlag::class,
            'follow' => Follow::class,
            'generation' => Generation::class,
            'help_article' => HelpArticle::class,
            'idempotency_key' => IdempotencyKey::class,
            'known_device' => KnownDevice::class,
            'legal_document' => LegalDocument::class,
            'make' => Make::class,
            'media' => Media::class,
            'message' => Message::class,
            'message_reaction' => MessageReactionRow::class,
            'mod_category' => ModCategory::class,
            'mod_category_field' => ModCategoryField::class,
            'modification' => Modification::class,
            'moderation_case' => ModerationCase::class,
            'notification' => Notification::class,
            'permission' => Permission::class,
            'personal_access_token' => PersonalAccessToken::class,
            'push_token' => PushToken::class,
            'qr_code' => QrCode::class,
            'qr_scan_daily' => QrScanDaily::class,
            'report' => Report::class,
            'role' => Role::class,
            'save' => Save::class,
            'staff' => Staff::class,
            'support_ticket' => SupportTicket::class,
            'ticket_message' => TicketMessage::class,
            'user' => User::class,
            'vehicle' => Vehicle::class,
            'vehicle_model' => VehicleModel::class,
            'vehicle_search' => VehicleSearch::class,
            'vehicle_spec' => VehicleSpec::class,
            'verification_code' => VerificationCode::class,
        ]);
    }
}
