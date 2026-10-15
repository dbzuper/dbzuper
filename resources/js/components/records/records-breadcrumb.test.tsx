import { act, fireEvent, render, screen } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { useRecords } from '@/records/records-store';
import { addRelated, nodeId, openRoot, pathTo } from '@/records/trail';
import { buildTrailSql } from '@/records/trail-sql';
import { useSqlTabs } from '@/sql/tabs-store';
import type { ConnectionSummary } from '@/types/connection';
import type { SchemaSnapshot, TableSchema } from '@/types/schema';
import { useWorkspace } from '@/universe/store';
import { RecordsBreadcrumb } from './records-breadcrumb';

const table = (name: string, columns = ['id']): TableSchema => ({
    name,
    kind: 'table',
    row_count: {} as never,
    size_bytes: null,
    primary_key: ['id'],
    columns: columns.map((c) => ({
        name: c,
        type: 'integer',
        type_name: 'integer',
        nullable: false,
        default: null,
        auto_increment: false,
        comment: null,
    })),
    indexes: [],
});
const snapshot = {
    driver: 'sqlite',
    database: 'd',
    schema: null,
    generated_at: '',
    hash: '',
    tables: [table('users'), table('notes', ['id', 'user_id'])],
    relationships: [
        {
            id: 'r2',
            from_table: 'notes',
            from_columns: ['user_id'],
            to_table: 'users',
            to_columns: ['id'],
            inferred: false,
            confidence: 1,
            name: null,
        },
    ],
} as SchemaSnapshot;
const connection = { id: 1 } as ConnectionSummary;

const usersId = nodeId('users', { id: 1 });
const noteId = nodeId('notes', { id: 5 });

function seed(edgeRel = 'r2') {
    const { trail } = addRelated(
        openRoot('users', { id: 1 }),
        usersId,
        edgeRel,
        'in',
        [{ table: 'notes', key: { id: 5 } }],
    );
    useRecords.setState({
        trail: { ...trail, selected: noteId },
        records: {
            [usersId]: {
                status: 'ready',
                payload: {
                    table: 'users',
                    key: { id: 1 },
                    columns: [
                        { name: 'id', type: 'int' },
                        { name: 'name', type: 'varchar' },
                    ],
                    values: [1, 'Ada'],
                    relationships: [],
                },
            },
        },
    });
    return trail;
}

beforeEach(() => {
    vi.restoreAllMocks();
    useRecords.getState().reset();
    useRecords.getState().setConnection(1);
    useSqlTabs.setState({ byConnection: {} } as never);
    useWorkspace.getState().reset();
});

describe('RecordsBreadcrumb', () => {
    it('renders nothing without a trail', () => {
        const { container } = render(
            <RecordsBreadcrumb connection={connection} snapshot={snapshot} />,
        );
        expect(container).toBeEmptyDOMElement();
    });

    it('shows the crumbs in path order with a title where known', () => {
        const trail = seed();
        render(
            <RecordsBreadcrumb connection={connection} snapshot={snapshot} />,
        );
        const crumbs = screen
            .getByRole('navigation', { name: 'Record path' })
            .querySelectorAll('[data-crumb]');
        expect(Array.from(crumbs, (c) => c.textContent)).toEqual(
            pathTo(trail, noteId)!.nodes.map((n) =>
                n.table === 'users' ? 'users · Ada' : 'notes · 5',
            ),
        );
        expect(
            screen.getByRole('button', { name: 'notes · 5' }),
        ).toHaveAttribute('aria-current', 'location');
    });

    it('selects a node when its crumb is clicked', () => {
        seed();
        render(
            <RecordsBreadcrumb connection={connection} snapshot={snapshot} />,
        );
        fireEvent.click(screen.getByRole('button', { name: 'users · Ada' }));
        expect(useRecords.getState().trail.selected).toBe(usersId);
    });

    it('opens a "Record path" tab with the exact SQL and the dock, and copies to the clipboard', async () => {
        const trail = seed();
        const writeText = vi.fn().mockResolvedValue(undefined);
        vi.stubGlobal('navigator', { clipboard: { writeText } });
        render(
            <RecordsBreadcrumb connection={connection} snapshot={snapshot} />,
        );
        const sql = buildTrailSql(trail, noteId, snapshot, 'sqlite')!;
        await act(async () => {
            fireEvent.click(
                screen.getByRole('button', { name: 'Copy path as SQL' }),
            );
        });
        const tabs = useSqlTabs.getState().byConnection[1].tabs;
        expect(tabs.at(-1)).toMatchObject({ title: 'Record path', sql });
        expect(useWorkspace.getState().dockOpen).toBe(true);
        expect(writeText).toHaveBeenCalledWith(sql);
        vi.unstubAllGlobals();
    });

    it('does not throw when the clipboard rejects or throws', async () => {
        seed();
        vi.stubGlobal('navigator', {
            clipboard: {
                writeText: vi.fn().mockRejectedValue(new Error('no')),
            },
        });
        render(
            <RecordsBreadcrumb connection={connection} snapshot={snapshot} />,
        );
        await act(async () => {
            fireEvent.click(
                screen.getByRole('button', { name: 'Copy path as SQL' }),
            );
        });
        const after = useSqlTabs.getState().byConnection[1].tabs.length;
        expect(useSqlTabs.getState().byConnection[1].tabs.at(-1)?.title).toBe(
            'Record path',
        );
        vi.stubGlobal('navigator', {
            clipboard: {
                writeText: () => {
                    throw new Error('sync');
                },
            },
        });
        await act(async () => {
            fireEvent.click(
                screen.getByRole('button', { name: 'Copy path as SQL' }),
            );
        });
        expect(useSqlTabs.getState().byConnection[1].tabs).toHaveLength(
            after + 1,
        );
        vi.unstubAllGlobals();
    });

    it('disables Copy path as SQL with an explanation when the path has no SQL', () => {
        seed('gone');
        render(
            <RecordsBreadcrumb connection={connection} snapshot={snapshot} />,
        );
        const button = screen.getByRole('button', { name: 'Copy path as SQL' });
        expect(button).toBeDisabled();
        expect(button).toHaveAttribute(
            'title',
            expect.stringContaining('relationship'),
        );
        fireEvent.click(button);
        expect(useWorkspace.getState().dockOpen).toBe(false);
    });

    it('closes the explorer and keeps the connection', () => {
        seed();
        render(
            <RecordsBreadcrumb connection={connection} snapshot={snapshot} />,
        );
        fireEvent.click(screen.getByRole('button', { name: 'Close explorer' }));
        expect(useRecords.getState().trail.nodes).toHaveLength(0);
        expect(useRecords.getState().connectionId).toBe(1);
    });

    it('shows the root and explains the disabled copy when nothing is selected', () => {
        seed();
        useRecords.setState({
            trail: { ...useRecords.getState().trail, selected: null },
        });
        render(
            <RecordsBreadcrumb connection={connection} snapshot={snapshot} />,
        );
        expect(
            screen.getByRole('button', { name: 'users · Ada' }),
        ).toBeInTheDocument();
        expect(
            screen.getByRole('button', { name: 'Copy path as SQL' }),
        ).toHaveAttribute('title', 'Select a record to copy its path');
    });

    it('disables copy for an unknown engine', () => {
        seed();
        render(
            <RecordsBreadcrumb
                connection={connection}
                snapshot={{ ...snapshot, driver: 'oracle' }}
            />,
        );
        const button = screen.getByRole('button', { name: 'Copy path as SQL' });
        expect(button).toBeDisabled();
        expect(button).toHaveAttribute(
            'title',
            expect.stringContaining('oracle'),
        );
    });
});
