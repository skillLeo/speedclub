<?php

use App\Http\Controllers\Admin\Config\ConfigDraftController;
use App\Http\Controllers\Admin\Config\Support\RollbackAtom;
use App\Http\Controllers\Admin\Content\AnnouncementsController;
use App\Http\Controllers\Admin\Content\HelpController;
use App\Http\Controllers\Admin\Content\HomeController;
use App\Http\Controllers\Admin\Content\LegalController;
use App\Http\Controllers\Admin\Content\PreviewController;
use App\Http\Controllers\Admin\Content\TemplatesController;
use App\Http\Controllers\Admin\Content\VersionsController;
use App\Http\Controllers\Admin\Support\AdminRoutes;
use Illuminate\Support\Facades\Route;

// ADM-29…35 (m3.5-contract §2). Every page needs content.view; drafts content.edit, publishing content.publish (legal texts
// legal.publish), each atom on the route ahead of the password check so a role without it hears 403, and again in the FormRequest and the
// Action. ⚿ = staff.recent-password (ADR-215) on every publish, rollback, delete and the template test mail. Drafts, previews and the
// template wording are allow-listed with their reasons in tests/Feature/Admin/M32/RecentPasswordRoutesTest.php.
$locales = 'de|en';

Route::middleware([...AdminRoutes::signedIn(), 'can:content.view'])->prefix('content')->name('content.')->group(function () use ($locales): void {
    // ADM-29 Startseite.
    Route::get('home', [HomeController::class, 'index'])->name('home');
    Route::get('home/vehicles', [HomeController::class, 'vehicles'])->middleware(['can:content.edit', 'throttle:60,1'])->name('home.vehicles');

    // ADM-30 Ankündigungen.
    Route::get('announcements', AnnouncementsController::class)->name('announcements');

    Route::middleware('throttle:30,1')->group(function (): void {
        foreach (['home' => 'home_curation', 'announcements' => 'announcements'] as $path => $key) {
            Route::post("$path/draft", [ConfigDraftController::class, 'save'])->defaults('key', $key)->middleware('can:content.edit')->name("$path.draft.save");
            Route::delete("$path/draft", [ConfigDraftController::class, 'discard'])->defaults('key', $key)->middleware('can:content.edit')->name("$path.draft.discard");
            Route::post("$path/publish", [ConfigDraftController::class, 'publish'])->defaults('key', $key)->middleware(['can:content.publish', 'staff.recent-password'])->name("$path.publish");
        }
    });

    // ADM-31 Rechtstexte.
    Route::get('legal', [LegalController::class, 'index'])->name('legal');
    Route::middleware('throttle:30,1')->group(function () use ($locales): void {
        Route::post('legal/preview', [LegalController::class, 'preview'])->middleware('can:content.edit')->name('legal.preview');
        Route::post('legal/{document}/{locale}/draft', [LegalController::class, 'save'])->middleware('can:content.edit')
            ->whereIn('document', ['imprint', 'privacy', 'terms', 'community', 'licenses'])->where('locale', $locales)->name('legal.draft.save');
        Route::delete('legal/drafts/{draft}', [LegalController::class, 'discard'])->middleware('can:content.edit')->whereNumber('draft')->name('legal.draft.discard');
        Route::post('legal/drafts/{draft}/publish', [LegalController::class, 'publish'])->middleware(['can:legal.publish', 'staff.recent-password'])->whereNumber('draft')->name('legal.publish');
    });

    // ADM-32 Hilfe.
    Route::get('help', [HelpController::class, 'index'])->name('help');
    Route::middleware('throttle:30,1')->group(function (): void {
        Route::post('help', [HelpController::class, 'store'])->middleware('can:content.edit')->name('help.store');
        Route::patch('help/{article}', [HelpController::class, 'update'])->middleware('can:content.edit')->whereNumber('article')->name('help.update');
        Route::post('help/{article}/published', [HelpController::class, 'published'])->middleware('can:content.publish')->whereNumber('article')->name('help.published');
        Route::delete('help/{article}', [HelpController::class, 'destroy'])->middleware(['can:content.publish', 'staff.recent-password'])->whereNumber('article')->name('help.destroy');
    });

    // ADM-33 E-Mail- und Push-Vorlagen.
    Route::get('templates', [TemplatesController::class, 'index'])->name('templates');
    Route::middleware(['can:content.edit', 'throttle:30,1'])->group(function () use ($locales): void {
        $template = '[a-z_]{1,20}\.[a-z_]{1,40}';
        Route::put('templates/{template}/{locale}', [TemplatesController::class, 'save'])->where(['template' => $template, 'locale' => $locales])->name('templates.save');
        Route::delete('templates/{template}/{locale}', [TemplatesController::class, 'reset'])->where(['template' => $template, 'locale' => $locales])->name('templates.reset');
        Route::post('templates/{template}/{locale}/preview', [TemplatesController::class, 'preview'])->where(['template' => $template, 'locale' => $locales])->name('templates.preview');
        Route::post('templates/{template}/{locale}/test', [TemplatesController::class, 'test'])->middleware(['staff.recent-password', 'throttle:6,1'])->where(['template' => $template, 'locale' => $locales])->name('templates.test');
    });

    // ADM-34 Entwurfsvorschau: a fresh preview token per visit (audited as config.preview_issued).
    Route::get('preview', PreviewController::class)->middleware('throttle:30,1')->name('preview');

    // ADM-35 Versionsverlauf; a rollback needs the key's publish atom, on the route ahead of the password check (code review SF-3), and
    // again in RollbackRequest and the Action.
    Route::get('versions', VersionsController::class)->name('versions');
    Route::post('versions/{key}/{version}/rollback', [ConfigDraftController::class, 'rollback'])
        ->middleware([RollbackAtom::class, 'staff.recent-password', 'throttle:30,1'])
        ->whereIn('key', ['branding', 'home_curation', 'announcements', 'remote_config'])->whereNumber('version')->name('versions.rollback');
});
