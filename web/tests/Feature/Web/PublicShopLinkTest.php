<?php

use App\Models\FeatureFlag;

/**
 * Client round 2 (2026-11-19): the website links to the shop while the `shop` flag is on, and not before (the store must exist).
 */
function shopFlag(bool $on): void
{
    FeatureFlag::query()->updateOrCreate(['key' => 'shop'], ['enabled' => $on]);
}

it('shows no shop link while the shop flag is off', function () {
    shopFlag(false);
    $html = (string) $this->get('/')->assertOk()->getContent();
    expect($html)->not->toContain('data-testid="WEB.topBar.shop"')->not->toContain('data-testid="WEB.footer.shop"');
});

it('links header and footer to the shop while the flag is on', function () {
    shopFlag(true);
    $html = (string) $this->get('/')->assertOk()->getContent();
    expect($html)->toContain('data-testid="WEB.topBar.shop"')->toContain('data-testid="WEB.footer.shop"')->toContain(url('/app/shop'));
});
