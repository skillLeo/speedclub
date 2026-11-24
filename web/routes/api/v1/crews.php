<?php

use App\Http\Controllers\Api\V1\Crews\CrewController;
use App\Http\Controllers\Api\V1\Crews\CrewInviteController;
use App\Http\Controllers\Api\V1\Crews\CrewMemberController;
use App\Http\Controllers\Api\V1\Crews\CrewMembershipController;
use App\Http\Controllers\Api\V1\Crews\CrewRequestController;
use App\Http\Middleware\EnsureFeatureEnabled;
use Illuminate\Support\Facades\Route;

// R4-2.3 Crews (docs/reports/round-4/contract-crews.md). Flag `crews` on every route (404 feature_disabled while off), after `member` on
// member routes so a guest hears 401 first. Crews are found by slug (an old slug too), requests and invitations by ULID, members by
// username. Creating POSTs take an Idempotency-Key; writes that publish something are closed under a publishing restriction.
$slug = '[A-Za-z0-9-]{1,64}';
$ulid = '[0-9A-Za-z]{26}';
$username = '[A-Za-z0-9._@]{1,41}';
$crews = EnsureFeatureEnabled::class.':crews';
$publishing = 'not-restricted:publishing';

// Guests too (ADR-124), read through App\Support\Viewer.
Route::middleware([$crews, 'throttle:browse'])->group(function () use ($slug, $username): void {
    Route::get('crews', [CrewController::class, 'index'])->middleware('etag')->name('crews.index');
    Route::get('crews/{slug}', [CrewController::class, 'show'])->where('slug', $slug)->middleware('etag')->name('crews.show');
    Route::get('crews/{slug}/members', [CrewController::class, 'members'])->where('slug', $slug)->middleware('etag')->name('crews.members.index');
    // PROF-01/02 crew chips.
    Route::get('public/users/{username}/crews', [CrewMembershipController::class, 'ofMember'])->where('username', $username)->middleware('etag')->name('public.users.crews');
});

Route::middleware('member')->group(function () use ($slug, $ulid, $username, $crews, $publishing): void {
    Route::middleware($crews)->group(function () use ($slug, $ulid, $username, $publishing): void {
        Route::get('me/crews', [CrewMembershipController::class, 'mine'])->middleware('throttle:browse')->name('me.crews.index');
        Route::get('me/crew-requests', [CrewMembershipController::class, 'requests'])->middleware('throttle:browse')->name('me.crew-requests.index');
        Route::get('me/crew-invites', [CrewInviteController::class, 'mine'])->middleware('throttle:browse')->name('me.crew-invites.index');
        Route::post('me/crew-invites/{id}/accept', [CrewInviteController::class, 'accept'])->where('id', $ulid)
            ->middleware([$publishing, 'throttle:crew-actions', 'idempotent'])->name('me.crew-invites.accept');
        Route::delete('me/crew-invites/{id}', [CrewInviteController::class, 'decline'])->where('id', $ulid)
            ->middleware('throttle:crew-actions')->name('me.crew-invites.decline');

        // Founding, editing, logo and cover, deleting.
        Route::post('crews', [CrewController::class, 'store'])->middleware([$publishing, 'throttle:crews', 'idempotent'])->name('crews.store');
        Route::patch('crews/{slug}', [CrewController::class, 'update'])->where('slug', $slug)
            ->middleware([$publishing, 'throttle:crews'])->name('crews.update');
        // Deleting one's own crew stays open under a restriction: taking one's own content down always works.
        Route::delete('crews/{slug}', [CrewController::class, 'destroy'])->where('slug', $slug)->middleware('throttle:crews')->name('crews.destroy');
        Route::post('crews/{slug}/logo', [CrewController::class, 'logo'])->where('slug', $slug)
            ->middleware([$publishing, 'throttle:uploads', 'idempotent'])->name('crews.logo.store');
        Route::post('crews/{slug}/cover', [CrewController::class, 'cover'])->where('slug', $slug)
            ->middleware([$publishing, 'throttle:uploads', 'idempotent'])->name('crews.cover.store');
        Route::delete('crews/{slug}/logo', [CrewController::class, 'removeLogo'])->where('slug', $slug)->middleware('throttle:crews')->name('crews.logo.destroy');
        Route::delete('crews/{slug}/cover', [CrewController::class, 'removeCover'])->where('slug', $slug)->middleware('throttle:crews')->name('crews.cover.destroy');

        // The member's own side.
        Route::post('crews/{slug}/join', [CrewMembershipController::class, 'join'])->where('slug', $slug)
            ->middleware([$publishing, 'throttle:crew-actions', 'idempotent'])->name('crews.join');
        Route::delete('crews/{slug}/join-request', [CrewMembershipController::class, 'withdraw'])->where('slug', $slug)
            ->middleware('throttle:crew-actions')->name('crews.join-request.destroy');
        Route::post('crews/{slug}/leave', [CrewMembershipController::class, 'leave'])->where('slug', $slug)
            ->middleware('throttle:crew-actions')->name('crews.leave');

        // Founder and admins: requests and invitations.
        Route::get('crews/{slug}/requests', [CrewRequestController::class, 'index'])->where('slug', $slug)->middleware('throttle:browse')->name('crews.requests.index');
        Route::post('crews/{slug}/requests/{id}/approve', [CrewRequestController::class, 'approve'])->where(['slug' => $slug, 'id' => $ulid])
            ->middleware([$publishing, 'throttle:crew-actions', 'idempotent'])->name('crews.requests.approve');
        Route::post('crews/{slug}/requests/{id}/decline', [CrewRequestController::class, 'decline'])->where(['slug' => $slug, 'id' => $ulid])
            ->middleware('throttle:crew-actions')->name('crews.requests.decline');
        Route::get('crews/{slug}/invites', [CrewInviteController::class, 'index'])->where('slug', $slug)->middleware('throttle:browse')->name('crews.invites.index');
        Route::post('crews/{slug}/invites', [CrewInviteController::class, 'store'])->where('slug', $slug)
            ->middleware([$publishing, 'throttle:crew-actions', 'idempotent'])->name('crews.invites.store');
        Route::delete('crews/{slug}/invites/{id}', [CrewInviteController::class, 'destroy'])->where(['slug' => $slug, 'id' => $ulid])
            ->middleware('throttle:crew-actions')->name('crews.invites.destroy');

        // Members and roles.
        Route::delete('crews/{slug}/members/{username}', [CrewMemberController::class, 'destroy'])->where(['slug' => $slug, 'username' => $username])
            ->middleware('throttle:crew-actions')->name('crews.members.destroy');
        Route::patch('crews/{slug}/members/{username}', [CrewMemberController::class, 'update'])->where(['slug' => $slug, 'username' => $username])
            ->middleware('throttle:crew-actions')->name('crews.members.update');
        Route::post('crews/{slug}/founder', [CrewMemberController::class, 'handOver'])->where('slug', $slug)
            ->middleware('throttle:crews')->name('crews.founder.store');
    });
});
