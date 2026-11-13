<?php

use App\Http\Controllers\Api\V1\Events\AttendeeController;
use App\Http\Controllers\Api\V1\Events\EventCalendarController;
use App\Http\Controllers\Api\V1\Events\EventController;
use App\Http\Controllers\Api\V1\Events\EventUpdateController;
use App\Http\Controllers\Api\V1\Events\GeocodeController;
use App\Http\Controllers\Api\V1\Events\MemberEventsController;
use App\Http\Controllers\Api\V1\Events\MyEventsController;
use App\Http\Controllers\Api\V1\Events\RsvpController;
use App\Http\Middleware\EnsureFeatureEnabled;
use Illuminate\Support\Facades\Route;

// M4.12 Events and meets (09 §8.7, §11). Flags: `events` (every route) and `events.create` (creating, sending, geocoding); a route of a
// flag that is off answers 404 feature_disabled, after `member` on member routes so a guest hears 401 first. Events are found by slug.
$slug = '[A-Za-z0-9-]{3,140}';
$events = EnsureFeatureEnabled::class.':events';
$create = EnsureFeatureEnabled::class.':events.create';

// Guests too (ADR-124), read through App\Support\Viewer.
Route::middleware([$events, 'throttle:browse'])->group(function () use ($slug): void {
    Route::get('events', [EventController::class, 'index'])->middleware('etag')->name('events.index');
    Route::get('events/pins', [EventController::class, 'pins'])->middleware('etag')->name('events.pins');
    Route::get('events/{slug}.ics', [EventCalendarController::class, 'show'])->where('slug', $slug)->name('events.ics');
    Route::get('events/{slug}', [EventController::class, 'show'])->where('slug', $slug)->middleware('etag')->name('events.show');
    // PROF-01/02 "Treffen": the events a member organises.
    Route::get('public/users/{username}/events', MemberEventsController::class)->where('username', '[A-Za-z0-9._]{1,40}')->middleware('etag')->name('public.users.events');
});

Route::middleware('member')->group(function () use ($slug, $events, $create): void {
    Route::middleware($events)->group(function () use ($slug, $create): void {
        Route::get('me/events', MyEventsController::class)->middleware('throttle:browse')->name('me.events');

        Route::post('events', [EventController::class, 'store'])
            ->middleware([$create, 'not-restricted:publishing', 'throttle:events', 'idempotent'])->name('events.store');
        Route::post('events/{slug}/submit', [EventController::class, 'submit'])->where('slug', $slug)
            ->middleware([$create, 'not-restricted:publishing', 'throttle:garage-edits'])->name('events.submit');
        Route::get('geocode', GeocodeController::class)->middleware([$create, 'throttle:geocode'])->name('geocode');

        // Organiser writes. Cancelling and deleting stay open under a publishing restriction: taking one's own content down always works.
        Route::patch('events/{slug}', [EventController::class, 'update'])->where('slug', $slug)
            ->middleware(['not-restricted:publishing', 'throttle:garage-edits'])->name('events.update');
        Route::delete('events/{slug}', [EventController::class, 'destroy'])->where('slug', $slug)->middleware('throttle:garage-edits')->name('events.destroy');
        Route::post('events/{slug}/cancel', [EventController::class, 'cancel'])->where('slug', $slug)->middleware('throttle:garage-edits')->name('events.cancel');
        Route::post('events/{slug}/cover', [EventController::class, 'cover'])->where('slug', $slug)
            ->middleware(['not-restricted:publishing', 'throttle:uploads', 'idempotent'])->name('events.cover');
        // Taking the cover off stays open under a publishing restriction, like deleting.
        Route::delete('events/{slug}/cover', [EventController::class, 'removeCover'])->where('slug', $slug)->middleware('throttle:garage-edits')->name('events.cover.destroy');
        Route::post('events/{slug}/updates', [EventUpdateController::class, 'store'])->where('slug', $slug)
            ->middleware(['not-restricted:publishing', 'throttle:event-updates', 'idempotent'])->name('events.updates.store');
        Route::delete('events/{slug}/attendees/{username}', [AttendeeController::class, 'destroy'])->where(['slug' => $slug, 'username' => '[A-Za-z0-9._]{1,40}'])
            ->middleware('throttle:garage-edits')->name('events.attendees.destroy');

        // Members.
        Route::put('events/{slug}/rsvp', [RsvpController::class, 'update'])->where('slug', $slug)->middleware('throttle:rsvps')->name('events.rsvp.update');
        Route::delete('events/{slug}/rsvp', [RsvpController::class, 'destroy'])->where('slug', $slug)->middleware('throttle:rsvps')->name('events.rsvp.destroy');
        Route::get('events/{slug}/attendees', [AttendeeController::class, 'index'])->where('slug', $slug)->middleware('throttle:browse')->name('events.attendees.index');
        Route::get('events/{slug}/updates', [EventUpdateController::class, 'index'])->where('slug', $slug)->middleware('throttle:browse')->name('events.updates.index');
    });
});
