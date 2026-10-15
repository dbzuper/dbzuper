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

const words = (list: string) => list.split(' ');

export const RESERVED = new Set(
    words(
        'SELECT FROM WHERE GROUP ORDER BY TABLE USER INDEX KEY PRIMARY REFERENCES CHECK DEFAULT LIMIT OFFSET JOIN ON AS AND OR NOT NULL IN IS LIKE BETWEEN CASE WHEN THEN ELSE END UNION ALL DISTINCT HAVING INSERT UPDATE DELETE CREATE DROP ALTER TO INTO VALUES SET DESC ASC COLUMN ' +
            'LEFT RIGHT RANK ROWS ROW WINDOW OVER FOR USING EXISTS TRUE FALSE GROUPS CONDITION TRIGGER LATERAL EXCEPT INTERSECT FETCH GRANT CURRENT_DATE CURRENT_TIME CURRENT_TIMESTAMP CURRENT_USER INNER OUTER CROSS FULL NATURAL RETURNING WITH ONLY FOREIGN UNIQUE CONSTRAINT ANALYZE DATABASE SCHEMA REPLACE RANGE PARTITION INTERVAL ILIKE SIMILAR',
    ),
);

/** Words that can follow a table name and so are never aliases. */
export const NON_ALIAS = new Set([...RESERVED, ...words('STRAIGHT_JOIN')]);
