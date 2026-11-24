<?php

namespace App\Services\Shop\Views;

/**
 * "Im Shop kaufen" (m5.5-contract §3.3): an https address on the store (`external`), the in-app path of the sticker designer
 * (`designer`), or not available yet (`not_configured`, "Bald im Shop erhältlich"). Built on the server only.
 */
final readonly class ShopBuyView
{
    public const EXTERNAL = 'external';

    public const DESIGNER = 'designer';

    public const DESIGNER_PATH = '/stickers';

    private function __construct(
        public bool $available,
        public ?string $kind,
        public ?string $url,
        public ?string $path,
    ) {}

    public static function external(string $url): self
    {
        return new self(true, self::EXTERNAL, $url, null);
    }

    public static function designer(): self
    {
        return new self(true, self::DESIGNER, null, self::DESIGNER_PATH);
    }

    public static function unavailable(): self
    {
        return new self(false, null, null, null);
    }

    /** `designer`, `external` or `not_configured` (the admin list's buy state). */
    public function state(): string
    {
        return $this->kind ?? 'not_configured';
    }
}
