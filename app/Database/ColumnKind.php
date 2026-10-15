<?php

namespace App\Database;

enum ColumnKind
{
    case Binary;
    case Text;
    case Other;

    public static function classify(string $typeName): self
    {
        $t = strtolower($typeName);

        return match (true) {
            (bool) preg_match('/blob|binary|bytea|varbinary|image/', $t) => self::Binary,
            (bool) preg_match('/char|text|json|xml|clob|citext/', $t) => self::Text,
            default => self::Other,
        };
    }
}
