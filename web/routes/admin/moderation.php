<?php

use App\Http\Controllers\Admin\Moderation\CaseActionsController;
use App\Http\Controllers\Admin\Moderation\CaseJsonController;
use App\Http\Controllers\Admin\Moderation\CaseShowController;
use App\Http\Controllers\Admin\Moderation\MessageCasesController;
use App\Http\Controllers\Admin\Moderation\ReportsBulkController;
use App\Http\Controllers\Admin\Moderation\ReportsQueueController;
use App\Http\Controllers\Admin\Moderation\RulesController;
use App\Http\Controllers\Admin\Moderation\TemplatesController;
use App\Http\Controllers\Admin\Support\AdminRoutes;
use Illuminate\Support\Facades\Route;

// ADM-20…24 (m3.4-contract §2). Every route needs moderation.view; each write adds its own atom on the route (ahead of the password check,
// so a role without it hears 403 rather than a password prompt) and in its FormRequest. ⚿ = staff.recent-password (ADR-215). A suspension
// only creates the `moderation.suspend` approval (ADR-214); evidence and message context are JSON answers, audited per opening.
$ulid = '[0-9A-Za-z]{26}';

Route::middleware([...AdminRoutes::signedIn(), 'can:moderation.view'])->prefix('moderation')->name('moderation.')->group(function () use ($ulid): void {
    Route::get('reports', ReportsQueueController::class)->name('reports');
    Route::post('reports/bulk', ReportsBulkController::class)->middleware(['can:moderation.decide', 'staff.recent-password', 'throttle:20,1'])->name('reports.bulk');

    Route::get('cases/{case}', CaseShowController::class)->where('case', $ulid)->name('cases.show');
    Route::get('messages', MessageCasesController::class)->middleware('can:moderation.messages')->name('messages');
    // SEC-P3-25: a web notifier's address, audited and capped per day (PiiReveals); JSON only. Outside the 60-a-minute group, whose
    // limiter would share its key with this one and count each request twice.
    Route::post('cases/{case}/reports/{report}/contact', [CaseJsonController::class, 'contact'])->middleware(['can:members.view_pii', 'throttle:30,1'])->where(['case' => $ulid, 'report' => $ulid])->name('cases.reports.contact');

    Route::middleware('throttle:60,1')->group(function () use ($ulid): void {
        Route::post('cases/{case}/assign', [CaseActionsController::class, 'assign'])->middleware('can:moderation.decide')->where('case', $ulid)->name('cases.assign');
        Route::post('cases/{case}/decide', [CaseActionsController::class, 'decide'])->middleware(['can:moderation.decide', 'staff.recent-password'])->where('case', $ulid)->name('cases.decide');
        Route::post('cases/{case}/preview', [CaseJsonController::class, 'preview'])->middleware('can:moderation.decide')->where('case', $ulid)->name('cases.preview');
        Route::post('cases/{case}/evidence', [CaseJsonController::class, 'evidence'])->middleware('throttle:30,1')->where('case', $ulid)->name('cases.evidence');
        Route::post('cases/{case}/live-context', [CaseJsonController::class, 'live'])->middleware(['can:moderation.messages', 'throttle:20,1'])->where('case', $ulid)->name('cases.live');
        Route::post('appeals/{appeal}/decide', [CaseActionsController::class, 'decideAppeal'])->middleware(['can:moderation.appeals', 'staff.recent-password'])->where('appeal', $ulid)->name('appeals.decide');
    });

    Route::middleware('can:moderation.rules')->group(function (): void {
        Route::get('rules', [RulesController::class, 'index'])->name('rules');
        Route::middleware(['staff.recent-password', 'throttle:30,1'])->group(function (): void {
            Route::post('rules', [RulesController::class, 'store'])->name('rules.store');
            Route::delete('rules/{rule}', [RulesController::class, 'destroy'])->whereNumber('rule')->name('rules.destroy');
            Route::post('rules/rate-limits', [RulesController::class, 'limits'])->name('rules.limits');
        });
    });

    Route::get('templates', [TemplatesController::class, 'index'])->name('templates');
    Route::middleware(['can:moderation.templates', 'throttle:30,1'])->group(function () use ($ulid): void {
        Route::post('templates', [TemplatesController::class, 'store'])->name('templates.store');
        Route::patch('templates/{template}', [TemplatesController::class, 'update'])->where('template', $ulid)->name('templates.update');
        Route::delete('templates/{template}', [TemplatesController::class, 'destroy'])->where('template', $ulid)->name('templates.destroy');
    });
});
