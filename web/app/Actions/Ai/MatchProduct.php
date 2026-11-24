<?php

namespace App\Actions\Ai;

use App\Enums\AiFeature;
use App\Models\AiTextNormalisation;
use App\Models\Product;
use App\Models\User;
use App\Services\Ai\Agents\ProductNormaliseAgent;
use App\Services\Ai\AiFailed;
use App\Services\Ai\AiGateway;
use App\Services\Parts\ProductSearch;
use Illuminate\Database\Eloquent\Collection;
use Illuminate\Support\Str;

/**
 * POST ai/products/match (ai.product_match, opt-in; 10 §8.2, m5.9-contract §2.2): a typed part ("kw v3") → products of our catalogue.
 * Catalogue first, without AI: every word must match (ProductSearch::matchWords). Only when that finds nothing does the AI turn the text
 * into the brand and product words a catalogue would use; the server searches with those words and answers catalogue products only (at
 * most 3) — the AI never names a product we do not list. The normalisation is cached per text and category for
 * `speedclub.ai.normalisation_cache_days` (the text only, never who typed it). Nothing is saved on the mod.
 *
 * @throws AiFailed
 */
class MatchProduct
{
    public const LIMIT = 3;

    public function __construct(private readonly AiGateway $gateway, private readonly ProductSearch $search) {}

    /**
     * @return array{normalized: string|null, products: Collection<int, Product>, ai: bool}
     */
    public function handle(User $member, string $text, ?string $category): array
    {
        $this->gateway->ensureMayUse(AiFeature::ProductMatch, $member);

        $direct = $this->search->matchWords(ProductSearch::words($text), $category, self::LIMIT);

        if ($direct->isNotEmpty()) {
            return ['normalized' => null, 'products' => $direct, 'ai' => false];
        }

        $normal = mb_strtolower(trim((string) preg_replace('/\s+/u', ' ', $text)));
        $key = hash('sha256', $normal.'|'.($category ?? ''));
        $cached = AiTextNormalisation::query()->where('cache_key', $key)->where('expires_at', '>', now())->first();

        if ($cached instanceof AiTextNormalisation) {
            $payload = $cached->payload;
        } else {
            $prompt = 'Typed part: '.Str::limit($normal, 80, '').($category === null ? '' : "\nCategory: ".$category);
            $answer = $this->gateway->ask(AiFeature::ProductMatch, new ProductNormaliseAgent, $prompt, member: $member);
            $terms = array_values(array_filter(array_map(
                fn (mixed $term): string => is_string($term) ? Str::limit(trim($term), 30, '') : '',
                array_slice($answer->list('terms'), 0, 4),
            ), fn (string $term): bool => $term !== ''));
            $payload = ['brand' => Str::limit(trim((string) $answer->string('brand')), 60, ''), 'terms' => $terms];

            AiTextNormalisation::query()->where('cache_key', $key)->delete();
            AiTextNormalisation::query()->create([
                'feature' => AiFeature::ProductMatch->value,
                'cache_key' => $key,
                'payload' => $payload,
                'created_at' => now(),
                'expires_at' => now()->addDays(config()->integer('speedclub.ai.normalisation_cache_days')),
            ]);
        }

        $words = array_values(array_filter([$payload['brand'], ...$payload['terms']], fn (string $word): bool => $word !== ''));
        $normalized = $words === [] ? null : implode(' ', $words);

        return ['normalized' => $normalized, 'products' => $normalized === null ? new Collection : $this->search->matchWords($words, $category, self::LIMIT), 'ai' => true];
    }
}
