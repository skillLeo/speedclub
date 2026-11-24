<?php

use Illuminate\Support\Facades\Storage;

/*
 * ADR-539: GET /storage/{path} serves the public disk through PHP where public/storage cannot be a link (a host without shell
 * that forbids symlink()). On a linked host the web server answers these URLs before Laravel sees them.
 */

beforeEach(function () {
    Storage::fake('public');
    Storage::fake('local');
});

it('serves a public file with a day of browser cache, an ETag, nosniff and a sandbox', function () {
    Storage::disk('public')->put('media/01abc/photo.jpg', 'jpeg-bytes');

    $response = $this->get('/storage/media/01abc/photo.jpg')->assertOk();

    expect($response->headers->get('Cache-Control'))->toContain('public')->toContain('max-age=86400')
        ->and($response->headers->get('ETag'))->not->toBeNull()
        ->and($response->headers->get('Last-Modified'))->not->toBeNull()
        ->and($response->headers->get('X-Content-Type-Options'))->toBe('nosniff')
        ->and($response->headers->get('Content-Security-Policy'))->toContain('sandbox')
        ->and($response->headers->getCookies())->toBe([])
        ->and($response->baseResponse->getFile()->getContent())->toBe('jpeg-bytes');
});

it('answers 304 to a matching ETag', function () {
    Storage::disk('public')->put('og/v/card.png', 'png-bytes');
    $etag = $this->get('/storage/og/v/card.png')->headers->get('ETag');

    $this->get('/storage/og/v/card.png', ['If-None-Match' => $etag])->assertStatus(304);
});

it('is a 404 for what a link would not serve either', function (string $path) {
    Storage::disk('public')->put('.gitignore', '*');
    Storage::disk('public')->put('media/.hidden', 'x');
    Storage::disk('public')->put('media/01abc/photo.jpg', 'jpeg-bytes');

    $this->get('/storage/'.$path)->assertNotFound();
})->with([
    'missing file' => 'media/nothing.jpg',
    'directory' => 'media/01abc',
    'directory with slash' => 'media/',
    'dot file' => '.gitignore',
    'nested dot file' => 'media/.hidden',
    'traversal' => '..%2F..%2F.env',
    'encoded traversal into private' => '..%2Fprivate%2Fx.jpg',
]);

it('never serves the private disk', function () {
    Storage::disk('local')->put('chat/secret.jpg', 'private-bytes');

    $this->get('/storage/chat/secret.jpg')->assertNotFound();
});

it('is a 404 when the public disk is not local (media on S3)', function () {
    Storage::disk('public')->put('media/photo.jpg', 'jpeg-bytes');
    config(['filesystems.disks.public.driver' => 's3']);

    $this->get('/storage/media/photo.jpg')->assertNotFound();
});
