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

    /** @return array{usable: bool, tool: ?string, path: ?string, version: ?string, reason: string} */
    public function toArray(): array
    {
        return ['usable' => $this->usable, 'tool' => $this->tool, 'path' => $this->path, 'version' => $this->version, 'reason' => $this->reason];
    }

    /** @param array{usable: bool, tool: ?string, path: ?string, version: ?string, reason: string} $a */
    public static function fromArray(array $a): self
    {
        return new self($a['usable'], $a['tool'], $a['path'], $a['version'], $a['reason']);
    }
}
