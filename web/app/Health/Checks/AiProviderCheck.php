<?php

namespace App\Health\Checks;

use App\Services\Ai\AiGateway;
use Illuminate\Support\Facades\Http;
use Spatie\Health\Checks\Check;
use Spatie\Health\Checks\Result;
use Throwable;

/**
 * AI provider reachability (02_PRODUCT_SPEC §6, ADR-031): every ai.* feature is off without a provider (speedclub.services.ai_provider),
 * so "not configured" is ok. Configured: the provider's name, whether its key is set (never the key), and one request to its base URL
 * with a 3-second limit (any HTTP answer means reachable).
 */
class AiProviderCheck extends Check
{
    public function run(): Result
    {
        $gateway = app(AiGateway::class);
        $provider = config('speedclub.services.ai_provider');

        if (! is_string($provider) || $provider === '') {
            return Result::make('not_configured')->meta(['configured' => false])->ok();
        }

        // The gateway's own answer (M3.7): what decides whether any ai.* feature can run.
        $meta = ['configured' => true, 'provider' => $gateway->provider(), 'model' => $gateway->model(), 'key_set' => $gateway->available()];

        if (! $gateway->available()) {
            return Result::make('no_key')->meta($meta)->warning("The {$gateway->provider()} provider has no key.");
        }

        $url = config("ai.providers.{$gateway->provider()}.url");

        if (! is_string($url) || ! str_starts_with($url, 'https://')) {
            return Result::make('configured')->meta($meta)->ok();
        }

        // Reachability only: a prompt every few minutes would cost money and log a call; ADM-50 "KI testen" runs a real one (probe()).
        try {
            Http::timeout(3)->connectTimeout(3)->get($url);
        } catch (Throwable) {
            return Result::make('unreachable')->meta([...$meta, 'reachable' => false])->failed("The {$gateway->provider()} provider did not answer.");
        }

        return Result::make('reachable')->meta([...$meta, 'reachable' => true])->ok();
    }
}
