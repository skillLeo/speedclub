<?php

use App\Enums\LegalDocumentKey;
use App\Http\Controllers\Api\V1\Events\EventCalendarController;
use App\Http\Controllers\Web\AccountDeletionPageController;
use App\Http\Controllers\Web\AppRouteRedirectController;
use App\Http\Controllers\Web\ContactPageController;
use App\Http\Controllers\Web\DevMailController;
use App\Http\Controllers\Web\EmailActionPageController;
use App\Http\Controllers\Web\GetAppPageController;
use App\Http\Controllers\Web\LandingController;
use App\Http\Controllers\Web\LegalPageController;
use App\Http\Controllers\Web\OgImageController;
use App\Http\Controllers\Web\PlatformFilesController;
use App\Http\Controllers\Web\PublicBrandController;
use App\Http\Controllers\Web\PublicBusinessController;
use App\Http\Controllers\Web\PublicEventController;
use App\Http\Controllers\Web\PublicMemberController;
use App\Http\Controllers\Web\PublicVehicleController;
use App\Http\Controllers\Web\QrScanController;
use App\Http\Controllers\Web\ReportFormController;
use App\Http\Controllers\Web\SpaController;
use App\Http\Middleware\PublicPageContext;
use App\Http\Middleware\RedirectMembersToApp;
use App\Http\PublicPages;
use Illuminate\Support\Facades\Route;

// Public pages go in this group: no session for guests. tests/Feature/Web/PublicPagesTest.php guards it.
Route::withoutMiddleware(PublicPages::WITHOUT_SESSION)->group(function (): void {
    Route::middleware(PublicPageContext::class)->group(function (): void {
        Route::get('/', LandingController::class)->middleware('throttle:public-read')->name('home');

        // Both spellings: a printed code is uppercase (02_PRODUCT_SPEC §3.4), and routes are case-sensitive.
        Route::get('/c/{code}', QrScanController::class)->middleware('throttle:qr')->name('qr.scan');
        Route::get('/C/{code}', QrScanController::class)->middleware('throttle:qr')->name('qr.scan.upper');

        Route::middleware('throttle:public-read')->group(function (): void {
            Route::get('/v/{slug}', PublicVehicleController::class)->middleware(RedirectMembersToApp::class)->name('public.vehicle');
            // Signed-in members read PROF-02 in the member web app since M2.1 (ADR-148 i, ADR-176 f); ?view=public stays here.
            Route::get('/u/{username}', PublicMemberController::class)->middleware(RedirectMembersToApp::class)->name('public.member');
            // M4.12 (09 §8.7, WEB-09): the calendar file of an event, public or signed for one member. Before the page, which would
            // otherwise take "x.ics" as its slug.
            Route::get('/e/{slug}.ics', [EventCalendarController::class, 'web'])->where('slug', '[A-Za-z0-9-]{3,140}')->name('public.event.ics');
            // M4.16 WEB-09 (09 §9): the public event page, behind the flag `events`; the place of an after_rsvp event stays the city.
            Route::get('/e/{slug}', PublicEventController::class)->where('slug', '[A-Za-z0-9-]{3,140}')->name('public.event');
            // M4.14 (09 §9 WEB-10/11): the business page with its Impressum (flag businesses) and the part brand page (flag parts_catalogue).
            Route::get('/b/{slug}', PublicBusinessController::class)->where('slug', '[A-Za-z0-9-]{2,140}')->name('public.business');
            Route::get('/brands/{slug}', PublicBrandController::class)->where('slug', '[A-Za-z0-9-]{1,140}')->name('public.brand');
        });

        Route::middleware('throttle:public-read')->name('legal.')->group(function (): void {
            Route::get('/impressum', LegalPageController::class)->defaults('document', LegalDocumentKey::Imprint->value)->name('imprint');
            Route::get('/datenschutz', LegalPageController::class)->defaults('document', LegalDocumentKey::Privacy->value)->name('privacy');
            Route::get('/agb', LegalPageController::class)->defaults('document', LegalDocumentKey::Terms->value)->name('terms');
            Route::get('/community-richtlinien', LegalPageController::class)->defaults('document', LegalDocumentKey::Community->value)->name('community');
        });

        // WEB-09 (M2.6, DSA Art. 16): sessionless, no CSRF token; ReportFormRequest refuses cross-site posts. throttle:reports counts
        // per IP here (20 a day), as no member is signed in on this route.
        Route::get('/melden', [ReportFormController::class, 'show'])->middleware('throttle:public-read')->name('report.show');
        Route::post('/melden', [ReportFormController::class, 'store'])->middleware('throttle:reports')->name('report.store');
        Route::get('/melden/gesendet', [ReportFormController::class, 'sent'])->middleware('throttle:public-read')->name('report.sent');

        // WEB-05 and WEB-10 (M2.5): sessionless GET and POST (ADR-115). The POSTs carry no CSRF token; Sec-Fetch-Site or Origin refuses
        // cross-site posts, the deletion needs the credentials, and both are limited per IP (plus per account for the deletion).
        Route::get('/konto-loeschen', [AccountDeletionPageController::class, 'show'])->middleware('throttle:public-read')->name('account-deletion.show');
        Route::post('/konto-loeschen', [AccountDeletionPageController::class, 'store'])->middleware('throttle:web-account-deletion')->name('account-deletion.store');
        Route::get('/kontakt', [ContactPageController::class, 'show'])->middleware('throttle:public-read')->name('contact.show');

        // WEB-04 and WEB-07 (M2.7): sessionless GETs. The e-mail landing carries its code in the fragment only (ADR-138), never in the URL.
        Route::get('/app-laden', GetAppPageController::class)->middleware('throttle:public-read')->name('get-app');
        Route::get('/email/{action}', EmailActionPageController::class)->whereIn('action', array_keys(EmailActionPageController::ACTIONS))->middleware('throttle:public-read')->name('email-action');
        Route::post('/kontakt', [ContactPageController::class, 'store'])->middleware('throttle:contact-form')->name('contact.store');

        // M4.6 WEB-12 (09 §8.1): the magic link of the e-mail code. The installed app claims the path (APP_PATHS); a browser lands in the
        // member web, which signs in only where its attempt id is stored and otherwise asks for the code. The token stays in the fragment,
        // which a redirect keeps and no server sees (ADR-138).
        Route::redirect('/auth/magic', '/app/auth/magic', 302)->middleware('throttle:public-read')->name('auth.magic');
        // M4.7 (09 §8.4): "Das war ich nicht" of a login alert, the same way (token in the fragment, POST auth/secure-account).
        Route::redirect('/auth/secure', '/app/auth/secure', 302)->middleware('throttle:public-read')->name('auth.secure');
        // M4.15 (ADR-453 e): SET-21 from the security mail and the login alert's push. The app claims the path; a browser without it
        // lands on the member web's screen, with ?event= kept.
        Route::get('/settings/security/activity', AppRouteRedirectController::class)->middleware('throttle:public-read')->name('security-activity');
    });

    // Link previews (og:image, twitter:image): a versioned JPEG, drawn on the first request when the queue has not drawn it yet.
    // M4.16: /e, /b and /brands draw through PartnerOgImages.
    Route::middleware('throttle:public-read')->group(function (): void {
        Route::get('/og/{type}/{file}', OgImageController::class)->whereIn('type', ['v', 'u', 'e', 'b', 'brands'])->where('file', '[A-Za-z0-9._-]+\.jpg')->name('og.image');
        Route::get('/og/{file}', OgImageController::class)->where('file', 'site-[0-9a-f]{16}(-square)?\.jpg')->name('og.site');
    });

    Route::get('/robots.txt', [PlatformFilesController::class, 'robots'])->name('robots');
    // Throttled: after SitemapWriter::forget() the next read renders from the whole table.
    Route::get('/sitemap.xml', [PlatformFilesController::class, 'sitemap'])->middleware('throttle:public-read')->name('sitemap');
    Route::get('/.well-known/assetlinks.json', [PlatformFilesController::class, 'assetLinks'])->name('well-known.assetlinks');
    Route::get('/.well-known/apple-app-site-association', [PlatformFilesController::class, 'appleAppSiteAssociation'])->name('well-known.aasa');
});

// Member web app (ADR-004). No session: the SPA talks to /api/v1 itself. Asset folders stay out of the
// fallback, so a missing chunk is a real 404 and not an HTML page with status 200.
Route::get('/app/{path?}', SpaController::class)
    ->where('path', '^(?!_expo/|assets/).*$')
    ->withoutMiddleware('web')
    ->name('spa');

// Local mail preview (docs/DEPLOY.md §10). Not registered at all in production: tests/Feature/Web/DevMailTest.php proves it.
/** @var list<string> $previewEnvironments */
$previewEnvironments = config()->array('speedclub.dev_mail.environments');

if (app()->environment($previewEnvironments)) {
    Route::withoutMiddleware(PublicPages::WITHOUT_SESSION)->prefix('dev/mail')->name('dev.mail.')->group(function (): void {
        Route::get('/', [DevMailController::class, 'index'])->name('index');
        Route::get('latest', [DevMailController::class, 'latest'])->name('latest');
    });
}
