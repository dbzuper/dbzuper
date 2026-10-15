import type { Dialect } from '@/types/schema';

export const COMMON = [
    'SELECT',
    'FROM',
    'WHERE',
    'JOIN',
    'LEFT JOIN',
    'INNER JOIN',
    'ON',
    'GROUP BY',
    'ORDER BY',
    'HAVING',
    'LIMIT',
    'OFFSET',
    'INSERT INTO',
    'VALUES',
    'UPDATE',
    'SET',
    'DELETE FROM',
    'AND',
    'OR',
    'NOT',
    'NULL',
    'IS NULL',
    'IS NOT NULL',
    'IN',
    'LIKE',
    'BETWEEN',
    'DISTINCT',
    'AS',
    'COUNT',
    'SUM',
    'AVG',
    'MIN',
    'MAX',
    'CASE',
    'WHEN',
    'THEN',
    'ELSE',
    'END',
    'WITH',
    'UNION',
    'EXPLAIN',
];

const MYSQL = [
    ...COMMON,
    'GROUP_CONCAT',
    'IFNULL',
    'NOW()',
    'SHOW TABLES',
    'DESCRIBE',
];

export const KEYWORDS: Record<Dialect, string[]> = {
    pgsql: [
        ...COMMON,
        'ILIKE',
        'RETURNING',
        'STRING_AGG',
        'COALESCE',
        'NOW()',
        'INTERVAL',
        'JSONB',
    ],
    mysql: MYSQL,
    mariadb: MYSQL,
    sqlite: [...COMMON, 'IFNULL', 'GROUP_CONCAT', 'PRAGMA'],
};

export const RESERVED = new Set(
    'SELECT FROM WHERE GROUP ORDER BY TABLE USER INDEX KEY PRIMARY REFERENCES CHECK DEFAULT LIMIT OFFSET JOIN ON AS AND OR NOT NULL IN IS LIKE BETWEEN CASE WHEN THEN ELSE END UNION ALL DISTINCT HAVING INSERT UPDATE DELETE CREATE DROP ALTER TO INTO VALUES SET DESC ASC COLUMN'.split(
        ' ',
    ),
);
