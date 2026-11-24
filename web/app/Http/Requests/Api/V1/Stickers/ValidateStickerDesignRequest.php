<?php

namespace App\Http\Requests\Api\V1\Stickers;

use App\Enums\StickerClientScanTest;
use Illuminate\Foundation\Http\FormRequest;
use Illuminate\Validation\Rule;

/**
 * POST vehicles/{vehicle}/sticker-design/validate: the Scan-Test of the current version.
 */
class ValidateStickerDesignRequest extends FormRequest
{
    /**
     * @return array<string, mixed>
     */
    public function rules(): array
    {
        return [
            // Must be the current version.
            'version' => ['required', 'integer', 'min:1'],
            // The app's own decode on the device; recorded, the server's test decides.
            'client_scan_test' => ['nullable', 'string', Rule::enum(StickerClientScanTest::class)],
        ];
    }

    public function version(): int
    {
        return (int) $this->validated('version');
    }

    public function clientScanTest(): ?StickerClientScanTest
    {
        $value = $this->validated('client_scan_test');

        return is_string($value) ? StickerClientScanTest::from($value) : null;
    }
}
