<?php

namespace App\Database\Errors;

final readonly class DbError
{
    /** @param 'connection'|'auth'|'timeout'|'syntax'|'permission'|'readonly'|'not_found'|'unknown' $kind */
    public function __construct(
        public string $kind,
        public string $message,
        public ?string $sqlstate,
        public ?string $reason,
    ) {}

    public function toArray(): array
    {
        return ['kind' => $this->kind, 'message' => $this->message, 'sqlstate' => $this->sqlstate, 'reason' => $this->reason];
    }
}
