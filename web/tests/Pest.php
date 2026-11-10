<?php

use Illuminate\Auth\SessionGuard;
use Illuminate\Foundation\Testing\RefreshDatabase;
use Illuminate\Session\Store;
use Illuminate\Support\Str;
use Tests\TestCase;

pest()->extend(TestCase::class)
    ->use(RefreshDatabase::class)
    ->in('Feature');

pest()->extend(TestCase::class)->in('Unit');

/**
 * Creates a real database session in which $user is signed in on $guard and returns its id.
 * Requests then authenticate only through the cookie, not through actingAs() and its in-memory user.
 */
function databaseSessionFor(mixed $user, string $guard): string
{
    config(['session.driver' => 'database']);

    $id = Str::random(40);
    $store = new Store('test', app('session')->driver('database')->getHandler(), $id, config()->string('session.serialization', 'php'));
    $store->put('login_'.$guard.'_'.sha1(SessionGuard::class), $user->getAuthIdentifier());
    $store->put('_token', Str::random(40));
    $store->save();

    // Boot may have resolved the array driver; the guard must share the store StartSession fills.
    app()->forgetInstance('session.store');
    app('auth')->forgetGuards();

    return $id;
}
