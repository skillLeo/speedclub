<?php

/*
 * Laravel AI SDK (laravel/ai, ADR-030). Only the text providers SPEED CLUB may use; the provider in force is
 * speedclub.services.ai_provider (AI_PROVIDER), the model speedclub.ai.model, both read by App\Services\Ai\AiGateway. No key is set
 * until the owner chooses a provider (OA-18); tests and dev use the SDK's fakes.
 */
return [

    'default' => env('AI_PROVIDER') ?: 'anthropic',
    'default_for_images' => 'gemini',
    'default_for_audio' => 'openai',
    'default_for_transcription' => 'openai',
    'default_for_embeddings' => 'openai',
    'default_for_reranking' => 'cohere',
    'default_for_classification' => 'typesafe',

    'caching' => [
        'embeddings' => [
            'cache' => false,
            'store' => env('CACHE_STORE', 'database'),
            'individually' => true,
        ],
    ],

    'providers' => [
        'anthropic' => [
            'driver' => 'anthropic',
            'key' => env('ANTHROPIC_API_KEY'),
            'url' => env('ANTHROPIC_URL', 'https://api.anthropic.com/v1'),
        ],

        'openai' => [
            'driver' => 'openai',
            'key' => env('OPENAI_API_KEY'),
            'url' => env('OPENAI_URL', 'https://api.openai.com/v1'),
            // Nothing stays with the provider for later reference.
            'store' => false,
        ],

        'mistral' => [
            'driver' => 'mistral',
            'key' => env('MISTRAL_API_KEY'),
        ],

        'gemini' => [
            'driver' => 'gemini',
            'key' => env('GEMINI_API_KEY'),
            'url' => env('GEMINI_URL', 'https://generativelanguage.googleapis.com/v1beta/'),
        ],
    ],

];
