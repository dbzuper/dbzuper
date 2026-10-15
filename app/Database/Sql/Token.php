<?php

namespace App\Database\Sql;

final readonly class Token
{
    /** @param 'word'|'quoted'|'string'|'number'|'punct'|'semicolon'|'comment' $type */
    public function __construct(public string $type, public string $value, public int $start, public int $end) {}

    public function upper(): string
    {
        return strtoupper($this->value);
    }

    /** Identifier text without quoting (for quoted and word tokens). */
    public function identifier(): string
    {
        if ($this->type !== 'quoted') {
            return $this->value;
        }
        $open = $this->value[0];
        $close = $open === '[' ? ']' : $open;
        $inner = substr($this->value, 1, -1);

        return $open === '[' ? $inner : str_replace($close.$close, $close, $inner);
    }
}
