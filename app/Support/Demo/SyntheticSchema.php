<?php

namespace App\Support\Demo;

use Illuminate\Database\Connection;
use Illuminate\Database\Schema\Blueprint;

/** Large, module-structured demo schema for exercising the universe at scale. */
final class SyntheticSchema
{
    public const MODULE_SIZE = 25;

    public static function name(int $module, int $position): string
    {
        return sprintf('m%03d_t%02d', $module, $position);
    }

    public static function create(Connection $db, int $tables): void
    {
        $schema = $db->getSchemaBuilder();

        $db->transaction(function () use ($schema, $tables) {
            for ($i = 0; $i < $tables; $i++) {
                $module = intdiv($i, self::MODULE_SIZE);
                $position = $i % self::MODULE_SIZE;

                $schema->create(self::name($module, $position), function (Blueprint $t) use ($module, $position) {
                    $t->id();
                    $t->string('name')->nullable();
                    if ($position > 0) {
                        $t->foreignId(self::name($module, $position - 1).'_id')->nullable()->constrained(self::name($module, $position - 1));
                    }
                    if ($position > 1 && $position % 2 === 0) {
                        $t->foreignId('ref_'.self::name($module, $position - 2).'_id')->nullable()->constrained(self::name($module, $position - 2));
                    }
                    if ($position === 0 && $module > 0) {
                        $t->foreignId('upstream_id')->nullable()->constrained(self::name($module - 1, 0));
                    }
                });
            }
        });
    }
}
