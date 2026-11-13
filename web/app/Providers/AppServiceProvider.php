<?php

namespace App\Providers;

use App\Exceptions\QueryExceptionReporter;
use App\Http\Middleware\EnsurePasswordCurrent;
use App\Models\Appeal;
use App\Models\AuditEvent;
use App\Models\Block;
use App\Models\Brand;
use App\Models\BuildUpdate;
use App\Models\Business;
use App\Models\BusinessMember;
use App\Models\BusinessViewDay;
use App\Models\CatalogRequest;
use App\Models\Comment;
use App\Models\ConfigVersion;
use App\Models\Conversation;
use App\Models\ConversationParticipant;
use App\Models\DataExport;
use App\Models\Decision;
use App\Models\DeviceInstall;
use App\Models\DiscoverCollection;
use App\Models\Event as ClubEvent;
use App\Models\EventRsvp;
use App\Models\EventUpdate;
use App\Models\FeatureFlag;
use App\Models\Follow;
use App\Models\Generation;
use App\Models\HelpArticle;
use App\Models\IdempotencyKey;
use App\Models\KnownDevice;
use App\Models\LegalDocument;
use App\Models\LoginAttempt;
use App\Models\MaintenanceItem;
use App\Models\MaintenanceLog;
use App\Models\MaintenanceReminder;
use App\Models\Make;
use App\Models\Media;
use App\Models\MemberCollection;
use App\Models\MemberCollectionItem;
use App\Models\MemberPasskey;
use App\Models\Mention;
use App\Models\Message;
use App\Models\MessageReactionRow;
use App\Models\ModBusinessTag;
use App\Models\ModCategory;
use App\Models\ModCategoryField;
use App\Models\ModerationCase;
use App\Models\Modification;
use App\Models\Notification;
use App\Models\PasskeyChallenge;
use App\Models\Permission;
use App\Models\PersonalAccessToken;
use App\Models\Product;
use App\Models\PushSubscription;
use App\Models\PushToken;
use App\Models\QrCode;
use App\Models\QrScanDaily;
use App\Models\Reaction;
use App\Models\Report;
use App\Models\Role;
use App\Models\Save;
use App\Models\SecurityEvent;
use App\Models\SocialAccount;
use App\Models\Staff;
use App\Models\SupportTicket;
use App\Models\TicketMessage;
use App\Models\User;
use App\Models\Vehicle;
use App\Models\VehicleFollow;
use App\Models\VehicleHighlight;
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

        // M4.6 ADM-61: the staff Mail-Vorschau records on every non-production host (staging without SMTP), never in production.
        $staffPreview = ! $this->app->isProduction() && config()->boolean('speedclub.mail_preview.enabled');

        if ($this->app->environment($previewEnvironments) || $staffPreview) {
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
            'business' => Business::class,
            'business_member' => BusinessMember::class,
            'business_view_day' => BusinessViewDay::class,
            'catalog_request' => CatalogRequest::class,
            'comment' => Comment::class,
            'config_version' => ConfigVersion::class,
            'conversation' => Conversation::class,
            'conversation_participant' => ConversationParticipant::class,
            'data_export' => DataExport::class,
            'decision' => Decision::class,
            'device_install' => DeviceInstall::class,
            'discover_collection' => DiscoverCollection::class,
            'event' => ClubEvent::class,
            'event_rsvp' => EventRsvp::class,
            'event_update' => EventUpdate::class,
            'feature_flag' => FeatureFlag::class,
            'follow' => Follow::class,
            'generation' => Generation::class,
            'help_article' => HelpArticle::class,
            'idempotency_key' => IdempotencyKey::class,
            'known_device' => KnownDevice::class,
            'legal_document' => LegalDocument::class,
            'login_attempt' => LoginAttempt::class,
            'maintenance_item' => MaintenanceItem::class,
            'maintenance_log' => MaintenanceLog::class,
            'maintenance_reminder' => MaintenanceReminder::class,
            'make' => Make::class,
            'member_collection' => MemberCollection::class,
            'member_collection_item' => MemberCollectionItem::class,
            'mention' => Mention::class,
            'media' => Media::class,
            'member_passkey' => MemberPasskey::class,
            'message' => Message::class,
            'message_reaction' => MessageReactionRow::class,
            'mod_category' => ModCategory::class,
            'mod_category_field' => ModCategoryField::class,
            'moderation_case' => ModerationCase::class,
            'modification' => Modification::class,
            'mod_business_tag' => ModBusinessTag::class,
            'notification' => Notification::class,
            'passkey_challenge' => PasskeyChallenge::class,
            'permission' => Permission::class,
            'personal_access_token' => PersonalAccessToken::class,
            'product' => Product::class,
            'push_subscription' => PushSubscription::class,
            'push_token' => PushToken::class,
            'qr_code' => QrCode::class,
            'qr_scan_daily' => QrScanDaily::class,
            'reaction' => Reaction::class,
            'report' => Report::class,
            'role' => Role::class,
            'save' => Save::class,
            'security_event' => SecurityEvent::class,
            'social_account' => SocialAccount::class,
            'staff' => Staff::class,
            'support_ticket' => SupportTicket::class,
            'ticket_message' => TicketMessage::class,
            'user' => User::class,
            'vehicle' => Vehicle::class,
            'vehicle_follow' => VehicleFollow::class,
            'vehicle_highlight' => VehicleHighlight::class,
            'vehicle_model' => VehicleModel::class,
            'vehicle_search' => VehicleSearch::class,
            'vehicle_spec' => VehicleSpec::class,
            'verification_code' => VerificationCode::class,
        ]);
    }
}
