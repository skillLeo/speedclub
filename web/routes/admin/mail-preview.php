<?php

use App\Http\Controllers\Admin\Support\AdminRoutes;
use App\Http\Controllers\Admin\System\MailPreviewController;
use App\Http\Controllers\Admin\System\MailPreviewFrameController;
use Illuminate\Support\Facades\Route;

// ADM-61 Mail-Vorschau (09 §8.1): staging without SMTP. Never registered in production; the controller refuses there as well. Owner only
// (system.mail_preview, SEC-M46-04): a recorded mail can hold a member's sign-in code, and staff never see member credentials.
if (! app()->isProduction() && config()->boolean('speedclub.mail_preview.enabled')) {
    Route::middleware([...AdminRoutes::signedIn(), 'can:system.mail_preview'])->group(function (): void {
        Route::get('system/mail-preview', MailPreviewController::class)->name('system.mail-preview');
        // DQ-1226: the opened mail's HTML for the page's sandboxed frame; the URL comes signed from an audited opening only. The mail
        // goes out as sent: the local Boost browser logger (a dev dependency, absent elsewhere) must not add its script, which the
        // sandbox would block with a console error.
        Route::get('system/mail-preview/{mail}/frame', MailPreviewFrameController::class)
            ->whereNumber('mail')
            ->middleware('signed:relative')
            ->withoutMiddleware('Laravel\\Boost\\Middleware\\InjectBoost')
            ->name('system.mail-preview.frame');
    });
}
