<?php

namespace App\Support\Demo;

use Illuminate\Database\Connection;
use Illuminate\Database\Schema\Blueprint;

/**
 * Portable demo/fixture schema covering the awkward cases DBZuper must handle:
 * declared FKs and Laravel-style unconstrained *_id columns, a self-referencing FK,
 * a composite PK, a table without a PK, a reserved-word table name, a Unicode name,
 * JSON/BLOB columns and a view.
 */
final class CommerceSchema
{
    private const TABLES = ['order_items', 'product_tags', 'orders', 'products', 'categories', 'users', 'group', 'audit_log', 'régions'];

    public static function drop(Connection $db): void
    {
        $db->statement('drop view if exists order_totals');
        $schema = $db->getSchemaBuilder();
        $schema->disableForeignKeyConstraints();
        foreach (self::TABLES as $table) {
            $schema->dropIfExists($table);
        }
        $schema->enableForeignKeyConstraints();
    }

    public static function create(Connection $db): void
    {
        $schema = $db->getSchemaBuilder();

        $schema->create('group', function (Blueprint $t) {
            $t->id();
            $t->string('name');
        });

        $schema->create('users', function (Blueprint $t) {
            $t->id();
            $t->unsignedBigInteger('group_id')->nullable(); // no FK on purpose (inferred)
            $t->string('name');
            $t->string('email')->unique();
            $t->json('profile')->nullable();
            $t->binary('avatar')->nullable();
            $t->timestamp('created_at')->nullable();
        });

        $schema->create('categories', function (Blueprint $t) {
            $t->id();
            $t->foreignId('parent_id')->nullable()->constrained('categories');
            $t->string('name');
        });

        $schema->create('products', function (Blueprint $t) {
            $t->id();
            $t->foreignId('category_id')->constrained();
            $t->string('name');
            $t->string('sku')->unique();
            $t->decimal('price', 10, 2);
        });

        $schema->create('orders', function (Blueprint $t) {
            $t->id();
            $t->unsignedBigInteger('user_id')->index(); // no FK on purpose (inferred)
            $t->string('status', 20);
            $t->timestamp('created_at')->nullable();
        });

        $schema->create('order_items', function (Blueprint $t) {
            $t->id();
            $t->foreignId('order_id')->constrained()->cascadeOnDelete();
            $t->foreignId('product_id')->constrained();
            $t->integer('quantity');
            $t->decimal('unit_price', 10, 2);
        });

        $schema->create('product_tags', function (Blueprint $t) {
            $t->foreignId('product_id')->constrained();
            $t->string('tag', 50);
            $t->primary(['product_id', 'tag']);
        });

        $schema->create('audit_log', function (Blueprint $t) {
            $t->string('event');
            $t->text('payload')->nullable();
            $t->timestamp('logged_at')->nullable();
        });

        $schema->create('régions', function (Blueprint $t) {
            $t->id();
            $t->string('nom');
        });

        $db->statement(
            'create view order_totals as select o.id as order_id, sum(oi.quantity * oi.unit_price) as total '
            .'from orders o join order_items oi on oi.order_id = o.id group by o.id'
        );

        self::seed($db);
    }

    private static function seed(Connection $db): void
    {
        $now = '2026-10-01 12:00:00';
        $db->table('group')->insert([['id' => 1, 'name' => 'Staff'], ['id' => 2, 'name' => 'Customers']]);
        $db->table('users')->insert([
            ['id' => 1, 'group_id' => 1, 'name' => 'Ada Lovelace', 'email' => 'ada@example.com', 'profile' => '{"plan":"pro"}', 'avatar' => null, 'created_at' => $now],
            ['id' => 2, 'group_id' => 2, 'name' => 'Alan Turing', 'email' => 'alan@example.com', 'profile' => null, 'avatar' => null, 'created_at' => $now],
            ['id' => 3, 'group_id' => 2, 'name' => 'Grace Hopper', 'email' => 'grace@example.com', 'profile' => '{"plan":"free"}', 'avatar' => null, 'created_at' => $now],
        ]);
        $db->table('categories')->insert([
            ['id' => 1, 'parent_id' => null, 'name' => 'Hardware'],
            ['id' => 2, 'parent_id' => 1, 'name' => 'Keyboards'],
        ]);
        $db->table('products')->insert([
            ['id' => 1, 'category_id' => 2, 'name' => 'Mechanical Keyboard', 'sku' => 'KB-001', 'price' => '149.00'],
            ['id' => 2, 'category_id' => 1, 'name' => 'USB Hub', 'sku' => 'HUB-002', 'price' => '29.50'],
        ]);
        $db->table('orders')->insert([
            ['id' => 1, 'user_id' => 2, 'status' => 'paid', 'created_at' => $now],
            ['id' => 2, 'user_id' => 3, 'status' => 'pending', 'created_at' => $now],
        ]);
        $db->table('order_items')->insert([
            ['id' => 1, 'order_id' => 1, 'product_id' => 1, 'quantity' => 1, 'unit_price' => '149.00'],
            ['id' => 2, 'order_id' => 1, 'product_id' => 2, 'quantity' => 2, 'unit_price' => '29.50'],
            ['id' => 3, 'order_id' => 2, 'product_id' => 2, 'quantity' => 1, 'unit_price' => '29.50'],
        ]);
        $db->table('product_tags')->insert([['product_id' => 1, 'tag' => 'bestseller'], ['product_id' => 1, 'tag' => 'rgb']]);
        $db->table('audit_log')->insert([['event' => 'order.paid', 'payload' => '{"order":1}', 'logged_at' => $now]]);
        $db->table('régions')->insert([['id' => 1, 'nom' => 'Île-de-France']]);
    }
}
