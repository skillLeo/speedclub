<?php

use App\Http\Controllers\Admin\Support\AdminRoutes;
use App\Http\Controllers\Admin\System\MailPreviewController;
use Illuminate\Support\Facades\Route;

// ADM-61 Mail-Vorschau (09 §8.1): staging without SMTP. Never registered in production; the controller refuses there as well. Owner only
// (system.mail_preview, SEC-M46-04): a recorded mail can hold a member's sign-in code, and staff never see member credentials.
if (! app()->isProduction() && config()->boolean('speedclub.mail_preview.enabled')) {
    Route::middleware([...AdminRoutes::signedIn(), 'can:system.mail_preview'])
        ->get('system/mail-preview', MailPreviewController::class)
        ->name('system.mail-preview');
}
