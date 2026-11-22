<?php

use App\Database\ConnectionFactory;
use Illuminate\Database\Connection;
use Tests\Support\Engines;
use Tests\Support\Fingerprint;
use Tests\Support\TransferFixture;

/**
 * On PostgreSQL, dbzuper_test keeps a schema another engine test leaves behind on purpose (dbzuper_other), which
 * the restore target never gets in this test, so the comparison here is limited to the fixture's schemas.
 *
 * @return list<string>|null
 */
function transferHarnessSchemas(string $engine): ?array
{
    return $engine === 'pgsql' ? TransferFixture::PG_SCHEMAS : null;
}

it('fingerprints two identical fixtures equally', function (string $engine) {
    Engines::skipUnlessAvailable($engine);
    $factory = app(ConnectionFactory::class);
    $source = Engines::savedConnection($engine);
    $target = Engines::prepareRestoreTarget($engine);

    try {
        $a = $factory->using($source, function (Connection $db) use ($engine) {
            TransferFixture::drop($db, $engine);
            TransferFixture::create($db, $engine);

            return Fingerprint::of($db, $engine, transferHarnessSchemas($engine));
        });
        $b = $factory->using($target, function (Connection $db) use ($engine) {
            TransferFixture::create($db, $engine);

            return Fingerprint::of($db, $engine, transferHarnessSchemas($engine));
        });

        expect($a)->toBe($b);

        $big = $engine === 'pgsql' ? 'public.rt_big' : 'rt_big';
        expect($a['tables'])->toHaveKeys(TransferFixture::tableKeys($engine))
            ->and($a['views'])->toHaveKeys(TransferFixture::viewKeys($engine))
            ->and($a['tables'][$big]['rows'])->toBe(2)
            ->and(strlen(TransferFixture::bigText()))->toBeGreaterThanOrEqual(2 * 1024 * 1024);
        if ($engine !== 'pgsql') {
            expect($a['triggers'])->toHaveKeys(['rt_order_items_note', 'rt_insert_log_mark'])
                ->and($a['tables']['rt_insert_log']['rows'])->toBe(2);
        } else {
            expect($a['sequences'])->toHaveKeys(['public.rt_serial_id_seq', 'Sales.invoice_no', 'Sales.order_id_seq'])
                ->and($a['enums'])->toBe(['public.mood' => ['sad', 'ok', 'happy']])
                ->and($a['tables']['public.rt_measurements']['rows'])->toBe(3);
        }
    } finally {
        $factory->using($source, fn (Connection $db) => TransferFixture::drop($db, $engine));
        Engines::dropRestoreTarget($engine);
    }
})->with(Engines::ENGINES);

it('notices a changed byte, a lost object or a moved sequence', function (string $engine) {
    Engines::skipUnlessAvailable($engine);
    $factory = app(ConnectionFactory::class);
    $target = Engines::prepareRestoreTarget($engine);
    $pg = $engine === 'pgsql';
    $t = fn (string $name) => $pg ? "public.{$name}" : $name;

    try {
        $factory->using($target, function (Connection $db) use ($engine, $pg, $t) {
            TransferFixture::create($db, $engine);
            $before = Fingerprint::of($db, $engine, transferHarnessSchemas($engine));
            $now = fn () => Fingerprint::of($db, $engine, transferHarnessSchemas($engine));

            // One character deep inside the 2 MB row: same row count, different checksum.
            $db->update("UPDATE rt_big SET body = REPLACE(body, 'Läuft', 'Lauft') WHERE id = 1");
            $after = $now();
            expect($after['tables'][$t('rt_big')]['rows'])->toBe($before['tables'][$t('rt_big')]['rows'])
                ->and($after['tables'][$t('rt_big')]['checksum'])->not->toBe($before['tables'][$t('rt_big')]['checksum']);

            // A binary value whose last byte changes.
            $db->update('UPDATE rt_types SET raw = '.TransferFixture::binaryLiteral($engine, TransferFixture::allBytes(254)."\x00").' WHERE id = 1');
            expect($now()['tables'][$t('rt_types')]['checksum'])->not->toBe($after['tables'][$t('rt_types')]['checksum']);

            // Floats rounded the way a 14-digit (double) or 6-digit (single) text cast would round them.
            $db->update('UPDATE rt_floats SET d = 0.3 WHERE id = 1');
            $floats = $now()['tables'][$t('rt_floats')]['checksum'];
            expect($floats)->not->toBe($before['tables'][$t('rt_floats')]['checksum']);
            if ($engine !== 'sqlite') {
                $db->update('UPDATE rt_floats SET f = 16777200 WHERE id = 1');
                expect($now()['tables'][$t('rt_floats')]['checksum'])->not->toBe($floats);
            }

            // The INSERT trigger applied a second time, as when a restore creates it before loading the data.
            if (! $pg) {
                $db->update('UPDATE rt_insert_log SET note = '.($engine === 'sqlite' ? "note || '+'" : "CONCAT(note, '+')").' WHERE id = 1');
                expect($now()['tables']['rt_insert_log']['checksum'])->not->toBe($before['tables']['rt_insert_log']['checksum']);
            }

            // A view whose definition changes but keeps its name.
            $db->statement('DROP VIEW rt_big_orders');
            $db->statement('CREATE VIEW rt_big_orders AS SELECT order_id FROM rt_order_totals WHERE total > 11');
            expect($now()['views'])->not->toBe($before['views']);

            // A lost index and a lost foreign key.
            $db->statement($pg || $engine === 'sqlite' ? 'DROP INDEX rt_order_items_qty_index' : 'DROP INDEX rt_order_items_qty_index ON rt_order_items');
            expect($now()['tables'][$t('rt_order_items')]['indexes'])->not->toBe($before['tables'][$t('rt_order_items')]['indexes']);
            if ($engine !== 'sqlite') {
                $db->statement($pg ? 'ALTER TABLE rt_cycle_b DROP CONSTRAINT rt_cycle_b_a_fk' : 'ALTER TABLE rt_cycle_b DROP FOREIGN KEY rt_cycle_b_a_fk');
                expect($now()['tables'][$t('rt_cycle_b')]['foreign_keys'])->toBe([]);
            }

            match ($engine) {
                'pgsql' => $db->select("SELECT setval('public.rt_serial_id_seq', 4, false)"),
                'sqlite' => $db->update("UPDATE sqlite_sequence SET seq = 3 WHERE name = 'rt_types'"),
                default => $db->statement('ALTER TABLE rt_types AUTO_INCREMENT = 3'),
            };
            expect($now()['sequences'])->not->toBe($before['sequences']);

            if ($engine === 'mariadb') {
                $db->statement('SET SESSION system_versioning_alter_history = KEEP');
                $db->statement('ALTER TABLE rt_versioned DROP SYSTEM VERSIONING');
                expect($now()['tables']['rt_versioned'])->not->toBe($before['tables']['rt_versioned']);
            }
            if ($pg) {
                $db->statement('ALTER TABLE "Sales"."order" ALTER COLUMN "we""ird" SET DEFAULT \'x\'');
                expect($now()['tables']['Sales.order']['columns'])->not->toBe($before['tables']['Sales.order']['columns']);
                $db->delete('DELETE FROM rt_measurements WHERE id = 150');
                expect($now()['tables']['public.rt_measurements']['partitions'])
                    ->not->toBe($before['tables']['public.rt_measurements']['partitions']);
            }
        });
    } finally {
        Engines::dropRestoreTarget($engine);
    }
})->with(Engines::ENGINES);
