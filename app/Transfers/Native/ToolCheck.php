<?php

namespace App\Transfers\Native;

final readonly class ToolCheck
{
    public function __construct(
        public bool $usable,
        public ?string $tool,
        public ?string $path,
        public ?string $version,
        public string $reason,
    ) {}

    public static function unusable(string $reason, ?string $tool = null, ?string $path = null): self
    {
        return new self(false, $tool, $path, null, $reason);
    }
}
