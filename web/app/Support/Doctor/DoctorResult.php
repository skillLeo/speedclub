<?php

namespace App\Support\Doctor;

use App\Enums\DoctorLevel;

final readonly class DoctorResult
{
    public function __construct(
        public DoctorLevel $level,
        public string $check,
        public string $detail,
    ) {}

    public static function ok(string $check, string $detail = ''): self
    {
        return new self(DoctorLevel::Ok, $check, $detail);
    }

    public static function warning(string $check, string $detail): self
    {
        return new self(DoctorLevel::Warning, $check, $detail);
    }

    public static function blocker(string $check, string $detail): self
    {
        return new self(DoctorLevel::Blocker, $check, $detail);
    }
}
