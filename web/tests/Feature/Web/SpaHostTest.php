<?php

beforeEach(function () {
    $this->index = tempnam(sys_get_temp_dir(), 'spa');
    file_put_contents($this->index, '<!doctype html><title>spa-marker</title>');
    config(['speedclub.spa.index' => $this->index]);
});

afterEach(function () {
    @unlink($this->index);
});

it('serves the SPA index with no-cache headers', function (string $uri) {
    $response = $this->get($uri)->assertOk();

    expect($response->baseResponse->getFile()->getPathname())->toBe($this->index)
        ->and($response->headers->get('Content-Type'))->toContain('text/html')
        ->and($response->headers->get('Cache-Control'))->toContain('no-store')->toContain('no-cache');
})->with(['/app', '/app/', '/app/v/x', '/app/garage/new/step-2']);

it('starts no session for the SPA host', function () {
    $response = $this->get('/app/v/x')->assertOk();

    expect($response->headers->getCookies())->toBe([]);
});

it('does not answer missing assets with the SPA page', function (string $uri) {
    $this->get($uri)->assertNotFound();
})->with(['/app/_expo/static/js/web/missing.js', '/app/assets/missing.png']);

it('shows a friendly 404 when the SPA is not exported', function () {
    config(['speedclub.spa.index' => $this->index.'.missing']);

    $this->get('/app/v/x')
        ->assertNotFound()
        ->assertSee('Die Web-App ist gerade nicht verfügbar');
});

it('renders the holding page on the public layout', function () {
    $this->get('/')
        ->assertOk()
        ->assertSee('SPEED CLUB')
        ->assertSee('data-theme="system"', false)
        ->assertSee('lang="de"', false);
});

it('answers the health endpoint', function () {
    $this->get('/up')->assertOk();
});
