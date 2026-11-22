<?php

namespace App\Transfers\Export;

final class DumpHeader
{
    /**
     * @param  array{app_version: string, engine: string, server_version: string, database: string, date: string, method: string, options: string, gaps: list<string>, schemas?: list<string>}  $meta
     */
    public static function render(array $meta, string $commentPrefix = '-- '): string
    {
        $lines = [
            'DBZuper dump',
            'App version: '.$meta['app_version'],
            'Engine: '.$meta['engine'],
            'Server version: '.$meta['server_version'],
            'Database: '.$meta['database'],
            'Date: '.$meta['date'],
            'Method: '.$meta['method'],
            'Options: '.$meta['options'],
        ];

        if (! empty($meta['schemas'])) {
            $lines[] = 'Schemas: '.implode(', ', $meta['schemas']);
        }
        if ($meta['gaps'] !== []) {
            $lines[] = 'Not included: '.implode(', ', $meta['gaps']);
        }

        $out = '';
        foreach ($lines as $line) {
            $out .= $commentPrefix.str_replace(["\r", "\n"], ' ', $line)."\n";
        }

        return $out;
    }
}
