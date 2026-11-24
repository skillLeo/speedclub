<?php

namespace App\Providers;

use App\Database\RetryingMySqlConnector;
use App\Exceptions\QueryExceptionReporter;
use App\Http\Middleware\EnsurePasswordCurrent;
use App\Models\Appeal;
use App\Models\AuditEvent;
use App\Models\Badge;
use App\Models\Block;
use App\Models\Brand;
use App\Models\BuildScore;
use App\Models\BuildScoreHistory;
use App\Models\BuildScoreRank;
use App\Models\BuildUpdate;
use App\Models\Business;
use App\Models\BusinessInvite;
use App\Models\BusinessMember;
use App\Models\BusinessViewDay;
use App\Models\CarOfTheDay;
use App\Models\CarOfTheDayCandidate;
use App\Models\CarOfTheDayVote;
use App\Models\CatalogRequest;
use App\Models\Comment;
use App\Models\ConfigVersion;
use App\Models\Conversation;
use App\Models\ConversationParticipant;
use App\Models\Crew;
use App\Models\CrewInvite;
use App\Models\CrewMember;
use App\Models\CrewRequest;
use App\Models\DataExport;
use App\Models\Decision;
use App\Models\DeCity;
use App\Models\DeviceInstall;
use App\Models\DexSet;
use App\Models\DiscoverCollection;
use App\Models\Event as ClubEvent;
use App\Models\EventCheckin;
use App\Models\EventCheckinCode;
use App\Models\EventPhoto;
use App\Models\EventRsvp;
use App\Models\EventUpdate;
use App\Models\FeatureFlag;
use App\Models\Follow;
use App\Models\ForumCategory;
use App\Models\ForumPost;
use App\Models\ForumThread;
use App\Models\Generation;
use App\Models\HelpArticle;
use App\Models\IdempotencyKey;
use App\Models\InviteCode;
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
use App\Models\ShopBanner;
use App\Models\ShopProduct;
use App\Models\ShopProductImage;
use App\Models\SocialAccount;
use App\Models\Spot;
use App\Models\SpotAlert;
use App\Models\Staff;
use App\Models\StickerDesign;
use App\Models\SupportTicket;
use App\Models\TicketMessage;
use App\Models\User;
use App\Models\UserBadge;
use App\Models\UserSetProgress;
use App\Models\Vehicle;
use App\Models\VehicleFollow;
use App\Models\VehicleHighlight;
use App\Models\VehicleModel;
use App\Models\VehicleSearch;
use App\Models\VehicleSpec;
use App\Models\VehicleSpotStat;
use App\Models\VerificationCode;
use App\Models\ViewDay;
use App\Models\ViewEvent;
use App\Models\ViewSalt;
use App\Models\WeeklyRecap;
use App\Models\Wrapped;
use App\Models\XpEvent;
use App\Services\Shop\ShopCatalogue;
use App\Services\Shop\ShopCatalogueFactory;
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
        // Client round 3: a connect refused by a host's per-second cap is retried briefly (RetryingMySqlConnector).
        $this->app->bind('db.connector.mysql', RetryingMySqlConnector::class);
        // The database cache store, rate limiter included, retries deadlock victims (config/cache.php). Registered in
        // booting(), as other providers may read the cache in their boot().
        $this->app->booting(function (): void {
            Cache::extend('database-retrying', fn (Application $app, array $config) => RetryingDatabaseStore::driver($app, $config));
        });

        // Every throttle:… and RateLimiter::hit() counts each hit on the database store, also under concurrency.
        $this->app->extend(RateLimiter::class, fn (RateLimiter $limiter): RateLimiter => LosslessRateLimiter::from($limiter));

        // M5.5 (m5.5-contract §2): the shop's catalogue driver, local unless the Shopify Storefront driver is configured.
        $this->app->bind(ShopCatalogue::class, fn (Application $app): ShopCatalogue => ShopCatalogueFactory::make($app));

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
            // M5.9d supporting system.
            'badge' => Badge::class,
            'car_of_the_day' => CarOfTheDay::class,
            // R4-2.1 Car of the Day voting.
            'car_of_the_day_candidate' => CarOfTheDayCandidate::class,
            'car_of_the_day_vote' => CarOfTheDayVote::class,
            'invite_code' => InviteCode::class,
            'user_badge' => UserBadge::class,
            'xp_event' => XpEvent::class,
            'block' => Block::class,
            'brand' => Brand::class,
            'build_score' => BuildScore::class,
            'build_score_history' => BuildScoreHistory::class,
            'build_score_rank' => BuildScoreRank::class,
            'build_update' => BuildUpdate::class,
            'business' => Business::class,
            'business_member' => BusinessMember::class,
            'business_invite' => BusinessInvite::class,
            'business_view_day' => BusinessViewDay::class,
            'catalog_request' => CatalogRequest::class,
            'comment' => Comment::class,
            // R4-2.3 crews.
            'crew' => Crew::class,
            'crew_member' => CrewMember::class,
            'crew_request' => CrewRequest::class,
            'crew_invite' => CrewInvite::class,
            'config_version' => ConfigVersion::class,
            'conversation' => Conversation::class,
            'conversation_participant' => ConversationParticipant::class,
            'data_export' => DataExport::class,
            'de_city' => DeCity::class,
            'decision' => Decision::class,
            'device_install' => DeviceInstall::class,
            'dex_set' => DexSet::class,
            'discover_collection' => DiscoverCollection::class,
            'event' => ClubEvent::class,
            'event_rsvp' => EventRsvp::class,
            'event_update' => EventUpdate::class,
            // M5.6 gallery and check-in.
            'event_checkin' => EventCheckin::class,
            'event_checkin_code' => EventCheckinCode::class,
            'event_photo' => EventPhoto::class,
            'feature_flag' => FeatureFlag::class,
            'follow' => Follow::class,
            // M5.8 Forum.
            'forum_category' => ForumCategory::class,
            'forum_post' => ForumPost::class,
            'forum_thread' => ForumThread::class,
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
            'sticker_design' => StickerDesign::class,
            // M5.5 Shop (ADM-66/67 audit targets).
            'shop_banner' => ShopBanner::class,
            'shop_product' => ShopProduct::class,
            'shop_product_image' => ShopProductImage::class,
            'reaction' => Reaction::class,
            'report' => Report::class,
            'role' => Role::class,
            'save' => Save::class,
            'security_event' => SecurityEvent::class,
            'social_account' => SocialAccount::class,
            'spot' => Spot::class,
            'spot_alert' => SpotAlert::class,
            'staff' => Staff::class,
            'support_ticket' => SupportTicket::class,
            'ticket_message' => TicketMessage::class,
            'user' => User::class,
            'user_set_progress' => UserSetProgress::class,
            'vehicle' => Vehicle::class,
            'vehicle_follow' => VehicleFollow::class,
            'vehicle_highlight' => VehicleHighlight::class,
            'vehicle_model' => VehicleModel::class,
            'vehicle_search' => VehicleSearch::class,
            'vehicle_spec' => VehicleSpec::class,
            'vehicle_spot_stat' => VehicleSpotStat::class,
            'verification_code' => VerificationCode::class,
            // M5.7 Engagement: view counting and the weekly recap.
            'view_day' => ViewDay::class,
            'view_event' => ViewEvent::class,
            'view_salt' => ViewSalt::class,
            'weekly_recap' => WeeklyRecap::class,
            'wrapped' => Wrapped::class,
        ]);
    }
}
