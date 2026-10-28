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
        /** @var array{line: int, column: ?int}|null */
        public ?array $position = null,
    ) {}

    /** @return array{kind: string, message: string, sqlstate: ?string, reason: ?string, position?: array{line: int, column: ?int}} */
    public function toArray(): array
    {
        $out = ['kind' => $this->kind, 'message' => $this->message, 'sqlstate' => $this->sqlstate, 'reason' => $this->reason];
        if ($this->position !== null) {
            $out['position'] = $this->position;
        }

        return $out;
    }
}
