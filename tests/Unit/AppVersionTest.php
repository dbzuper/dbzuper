<?php

use App\Support\AppVersion;

afterEach(function () {
    foreach (glob(sys_get_temp_dir().'/dbz-version-*') ?: [] as $dir) {
        array_map('unlink', glob($dir.'/*') ?: []);
        rmdir($dir);
    }
});

function versionFixture(array $files): string
{
    $dir = sys_get_temp_dir().'/dbz-version-'.bin2hex(random_bytes(4));
    mkdir($dir);
    foreach ($files as $name => $content) {
        file_put_contents("{$dir}/{$name}", $content);
    }

    return $dir;
}

it('prefers the composer.json version', function () {
    expect(AppVersion::detect(versionFixture(['composer.json' => '{"version": "1.2.3"}', 'CHANGELOG.md' => "## 0.1.0\n"])))->toBe('1.2.3');
});

it('falls back to the newest changelog heading', function (string $changelog) {
    expect(AppVersion::detect(versionFixture(['composer.json' => '{}', 'CHANGELOG.md' => "# Changelog\n\n{$changelog}\n\n## 0.1.0\n"])))->toBe('0.3.0');
})->with(['## 0.3.0 (2026-11-10)', '## [0.3.0] - 2026-11-10', '## v0.3.0']);

it('says dev when nothing names a version', function () {
    expect(AppVersion::detect(versionFixture(['CHANGELOG.md' => "# Changelog\n"])))->toBe('dev');
});
