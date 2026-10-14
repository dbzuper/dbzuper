<?php

use App\Database\Exceptions\SqlitePathNotAllowed;
use App\Database\SqlitePathPolicy;

beforeEach(function () {
    $this->root = sys_get_temp_dir().DIRECTORY_SEPARATOR.'dbsuperb-policy-'.bin2hex(random_bytes(4));
    mkdir($this->root.'/allowed/nested', 0777, true);
    mkdir($this->root.'/allowed-evil', 0777, true);
    touch($this->root.'/allowed/app.sqlite');
    touch($this->root.'/allowed/nested/deep.sqlite');
    touch($this->root.'/allowed-evil/steal.sqlite');
    touch($this->root.'/outside.sqlite');
    $this->policy = new SqlitePathPolicy([$this->root.'/allowed']);
});

afterEach(function () {
    exec(PHP_OS_FAMILY === 'Windows' ? 'rmdir /s /q "'.$this->root.'"' : 'rm -rf '.escapeshellarg($this->root));
});

it('resolves files inside an allowed directory, including nested ones', function () {
    expect($this->policy->resolve($this->root.'/allowed/app.sqlite'))->toBe(realpath($this->root.'/allowed/app.sqlite'))
        ->and($this->policy->resolve($this->root.'/allowed/nested/deep.sqlite'))->toBe(realpath($this->root.'/allowed/nested/deep.sqlite'));
});

it('rejects files outside, including via .. traversal', function (string $relative) {
    expect(fn () => $this->policy->resolve($this->root.$relative))
        ->toThrow(SqlitePathNotAllowed::class);
})->with(['/outside.sqlite', '/allowed/../outside.sqlite', '/allowed/nested/../../outside.sqlite']);

it('rejects a sibling directory that merely shares the allowed prefix', function () {
    expect(fn () => $this->policy->resolve($this->root.'/allowed-evil/steal.sqlite'))
        ->toThrow(SqlitePathNotAllowed::class);
});

it('reports missing files distinctly', function () {
    try {
        $this->policy->resolve($this->root.'/allowed/nope.sqlite');
        $this->fail('expected exception');
    } catch (SqlitePathNotAllowed $e) {
        expect($e->reason)->toBe('missing');
    }
});

it('rejects a symlink that escapes the allowed directory', function () {
    $link = $this->root.'/allowed/link.sqlite';
    if (! @symlink($this->root.'/outside.sqlite', $link)) {
        $this->markTestSkipped('symlinks not permitted on this system');
    }

    expect(fn () => $this->policy->resolve($link))->toThrow(SqlitePathNotAllowed::class);
});

it('allows nothing when no directories are configured', function () {
    expect(fn () => (new SqlitePathPolicy([]))->resolve($this->root.'/allowed/app.sqlite'))
        ->toThrow(SqlitePathNotAllowed::class);
});

it('accepts forward or back slashes and different case on Windows', function () {
    if (PHP_OS_FAMILY !== 'Windows') {
        $this->markTestSkipped('Windows only');
    }
    $policy = new SqlitePathPolicy([strtoupper(str_replace('/', '\\', $this->root.'/allowed'))]);

    expect($policy->resolve($this->root.'/allowed/app.sqlite'))->toBe(realpath($this->root.'/allowed/app.sqlite'));
});
