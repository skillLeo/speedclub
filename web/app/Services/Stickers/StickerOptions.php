<?php

namespace App\Services\Stickers;

use App\Enums\StickerColourway;
use App\Enums\StickerMaterial;
use App\Enums\StickerSize;
use App\Enums\StickerTemplate;

/**
 * The options of one sticker design (m5.4-contract §1.1), normalised: every key present, enums resolved. What a template does not show
 * (StickerCatalogue::textOptions) stays stored, so switching templates back and forth loses nothing; effective() says what is printed.
 */
final readonly class StickerOptions
{
    public const KEYS = ['size', 'colourway', 'material', 'qr', 'username', 'car_name', 'custom_line', 'mirrored'];

    public function __construct(
        public StickerTemplate $template,
        public StickerSize $size,
        public StickerColourway $colourway,
        public StickerMaterial $material,
        public bool $qr,
        public bool $username,
        public bool $carName,
        public ?string $customLine,
        public bool $mirrored,
    ) {}

    public static function defaults(StickerTemplate $template, bool $showOwner = true): self
    {
        return new self(
            template: $template,
            size: StickerSize::M,
            colourway: StickerColourway::White,
            material: StickerMaterial::Transparent,
            qr: StickerCatalogue::qrDefault($template),
            username: $showOwner,
            carName: false,
            customLine: null,
            mirrored: false,
        );
    }

    /**
     * From stored or already validated input; unknown values fall back to the defaults, so an old row always renders.
     *
     * @param  array<string, mixed>  $options
     */
    public static function fromArray(StickerTemplate $template, array $options, ?self $base = null): self
    {
        $base ??= self::defaults($template);
        $line = array_key_exists('custom_line', $options) ? $options['custom_line'] : $base->customLine;
        $line = is_string($line) ? trim($line) : null;

        return new self(
            template: $template,
            size: StickerSize::tryFrom(self::string($options, 'size')) ?? $base->size,
            colourway: StickerColourway::tryFrom(self::string($options, 'colourway')) ?? $base->colourway,
            material: StickerMaterial::tryFrom(self::string($options, 'material')) ?? $base->material,
            qr: self::bool($options, 'qr', $base->qr),
            username: self::bool($options, 'username', $base->username),
            carName: self::bool($options, 'car_name', $base->carName),
            customLine: $line === '' ? null : $line,
            mirrored: self::bool($options, 'mirrored', $base->mirrored),
        );
    }

    public function withTemplate(StickerTemplate $template): self
    {
        return new self($template, $this->size, $this->colourway, $this->material, $this->qr, $this->username, $this->carName, $this->customLine, $this->mirrored);
    }

    /**
     * @return array{size: string, colourway: string, material: string, qr: bool, username: bool, car_name: bool, custom_line: string|null, mirrored: bool}
     */
    public function toArray(): array
    {
        return [
            'size' => $this->size->value,
            'colourway' => $this->colourway->value,
            'material' => $this->material->value,
            'qr' => $this->qr,
            'username' => $this->username,
            'car_name' => $this->carName,
            'custom_line' => $this->customLine,
            'mirrored' => $this->mirrored,
        ];
    }

    /**
     * What this template prints of the text options.
     *
     * @return array{username: bool, car_name: bool, custom_line: bool}
     */
    public function effective(): array
    {
        $shown = StickerCatalogue::textOptions($this->template);

        return [
            'username' => $this->username && in_array('username', $shown, true),
            'car_name' => $this->carName && in_array('car_name', $shown, true),
            'custom_line' => $this->customLine !== null && in_array('custom_line', $shown, true),
        ];
    }

    /**
     * @param  array<string, mixed>  $options
     */
    private static function string(array $options, string $key): string
    {
        return is_string($options[$key] ?? null) ? $options[$key] : '';
    }

    /**
     * @param  array<string, mixed>  $options
     */
    private static function bool(array $options, string $key, bool $default): bool
    {
        return is_bool($options[$key] ?? null) ? $options[$key] : $default;
    }
}
