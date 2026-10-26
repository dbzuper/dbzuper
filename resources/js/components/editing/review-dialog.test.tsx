import {
    act,
    fireEvent,
    render,
    screen,
    waitFor,
} from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { ChangeSetError, type ChangeSetErrorInfo } from '@/editing/editing-api';
import { refOf, usePending } from '@/editing/pending-store';
import { reconcilePending } from '@/editing/reconcile-pending';
import { useReview } from '@/editing/review-store';

const api = vi.hoisted(() => ({ preview: vi.fn(), commit: vi.fn() }));
vi.mock('@/editing/editing-api', async (orig) => ({
    ...(await orig<typeof import('@/editing/editing-api')>()),
    editingApi: api,
}));

const toast = vi.hoisted(() =>
    Object.assign(vi.fn(), { success: vi.fn(), error: vi.fn() }),
);
vi.mock('sonner', () => ({ toast }));

const writeClipboard = vi.hoisted(() => vi.fn(async () => true));
vi.mock('@/grid/copy', async (orig) => ({
    ...(await orig<typeof import('@/grid/copy')>()),
    writeClipboard,
}));

import { ReviewDialog } from './review-dialog';

const C = '1';
const T = 'orders';
const id1 = { key: { id: 1 } };
const ref1 = refOf(id1);

const statements = [
    {
        index: 1,
        op: 'delete',
        sql: 'DELETE FROM `orders` WHERE `id` = 2',
        target: 'id = 2',
    },
    {
        index: 0,
        op: 'update',
        sql: "UPDATE `orders` SET `status` = 'paid' WHERE `id` = 1",
        target: 'id = 1',
    },
    {
        index: 2,
        op: 'insert',
        sql: "INSERT INTO `orders` (`status`) VALUES ('new')",
        target: 'new row',
    },
];

let insertRef = '';

function stage() {
    const s = usePending.getState();
    s.setCell(
        C,
        T,
        { ref: ref1, id: id1, original: { status: 'open' } },
        'status',
        'paid',
    );
    const id2 = { key: { id: 2 } };
    s.markDelete(C, T, { ref: refOf(id2), id: id2, original: {} });
    insertRef = s.addRow(C, T);
    s.setCell(
        C,
        T,
        { ref: insertRef, id: null, original: {} },
        'status',
        'new',
    );
}

const fail = (info: Partial<ChangeSetErrorInfo>) =>
    new ChangeSetError({
        kind: 'row_mismatch',
        message: 'row changed since you loaded it',
        index: null,
        reason: null,
        sqlstate: null,
        status: 409,
        ...info,
    });

beforeEach(() => {
    usePending.setState({ byTable: {}, errors: {} });
    useReview.setState({ open: null, nonce: 0, committing: {}, deferred: {} });
    toast.mockReset();
    api.preview.mockReset();
    api.commit.mockReset();
    toast.success.mockReset();
    writeClipboard.mockClear();
    api.preview.mockResolvedValue({ statements });
    stage();
});

const openDialog = (onCommitted = vi.fn()) => {
    render(
        <ReviewDialog connectionId={C} table={T} onCommitted={onCommitted} />,
    );
    act(() => useReview.getState().openReview(C, T));
    return onCommitted;
};

describe('ReviewDialog', () => {
    it('lists the server statements in order with their targets and the transaction note', async () => {
        openDialog();
        const items = await screen.findAllByRole('listitem');
        expect(items.map((li) => li.querySelector('pre')?.textContent)).toEqual(
            statements.map((s) => s.sql),
        );
        expect(items[0]).toHaveTextContent('id = 2');
        expect(
            screen.getByText(
                'Runs as one transaction: all of them succeed, or nothing changes.',
            ),
        ).toBeInTheDocument();
        expect(api.preview).toHaveBeenCalledWith(C, T, expect.any(Array));
        expect(api.preview.mock.calls[0][2]).toHaveLength(3);
        expect(
            screen.getByRole('button', { name: 'Commit 3 changes' }),
        ).toBeEnabled();
    });

    it('sends a cleared integer as NULL and shows the server SQL for it', async () => {
        usePending.setState({ byTable: {}, errors: {} });
        usePending
            .getState()
            .setCell(
                C,
                T,
                { ref: ref1, id: id1, original: { created_by: 7 } },
                'created_by',
                null,
            );
        const sql = 'UPDATE `orders` SET `created_by` = NULL WHERE `id` = 1';
        api.preview.mockResolvedValue({
            statements: [{ index: 0, op: 'update', sql, target: 'id = 1' }],
        });
        openDialog();
        const items = await screen.findAllByRole('listitem');
        expect(items[0].querySelector('pre')).toHaveTextContent(sql);
        expect(api.preview.mock.calls[0][2]).toEqual([
            expect.objectContaining({
                op: 'update',
                values: { created_by: null },
            }),
        ]);
    });

    it('copies all statements', async () => {
        openDialog();
        await screen.findAllByRole('listitem');
        fireEvent.click(screen.getByRole('button', { name: 'Copy SQL' }));
        expect(writeClipboard).toHaveBeenCalledWith(
            statements.map((s) => `${s.sql};`).join('\n'),
        );
    });

    it('fetches a fresh preview every time it opens', async () => {
        openDialog();
        await screen.findAllByRole('listitem');
        fireEvent.click(screen.getByRole('button', { name: 'Back' }));
        expect(useReview.getState().open).toBeNull();
        // Back keeps everything staged.
        expect(usePending.getState().count(C, T)).toEqual({
            inserted: 1,
            updated: 1,
            deleted: 1,
        });
        act(() => usePending.getState().revertCell(C, T, ref1, 'status'));
        act(() => useReview.getState().openReview(C, T));
        await waitFor(() => expect(api.preview).toHaveBeenCalledTimes(2));
        expect(api.preview.mock.calls[1][2]).toHaveLength(2);
    });

    it('commits, clears the pending changes and reports it', async () => {
        let resolve!: (v: unknown) => void;
        api.commit.mockReturnValue(new Promise((r) => (resolve = r)));
        const onCommitted = openDialog();
        await screen.findAllByRole('listitem');
        fireEvent.click(
            screen.getByRole('button', { name: 'Commit 3 changes' }),
        );
        // Nothing can be pressed twice while it runs.
        expect(
            screen.getByRole('button', { name: /Committing/ }),
        ).toBeDisabled();
        expect(screen.getByRole('button', { name: 'Back' })).toBeDisabled();
        expect(api.commit.mock.calls[0][2]).toHaveLength(3);
        await act(async () =>
            resolve({ applied: { inserted: 1, updated: 1, deleted: 1 } }),
        );
        expect(usePending.getState().byTable[`${C}:${T}`]).toBeUndefined();
        expect(onCommitted).toHaveBeenCalledTimes(1);
        expect(toast.success).toHaveBeenCalledWith('3 changes committed');
        expect(useReview.getState().open).toBeNull();
    });

    it('defers a schema refresh landing mid-commit until the commit ends, so nothing is committed twice', async () => {
        let resolve!: (v: unknown) => void;
        api.commit.mockReturnValue(new Promise((r) => (resolve = r)));
        openDialog();
        await screen.findAllByRole('listitem');
        fireEvent.click(
            screen.getByRole('button', { name: 'Commit 3 changes' }),
        );
        const before = usePending.getState().byTable[`${C}:${T}`];
        // The refreshed schema lost `note` (which no change uses) and `status` (which they do).
        act(() => reconcilePending(C, new Map([[T, ['id']]])));
        expect(usePending.getState().byTable[`${C}:${T}`]).toBe(before);
        expect(useReview.getState().committing).toEqual({
            [`${C}:${T}`]: true,
        });
        await act(async () =>
            resolve({ applied: { inserted: 1, updated: 1, deleted: 1 } }),
        );
        // Every committed change settled; the deferred refresh then found nothing to drop.
        expect(usePending.getState().byTable[`${C}:${T}`]).toBeUndefined();
        expect(useReview.getState().committing).toEqual({});
        expect(toast).not.toHaveBeenCalled();
    });

    it('applies a deferred refresh after a failed commit', async () => {
        let reject!: (e: unknown) => void;
        api.commit.mockReturnValue(new Promise((_, r) => (reject = r)));
        openDialog();
        await screen.findAllByRole('listitem');
        fireEvent.click(
            screen.getByRole('button', { name: 'Commit 3 changes' }),
        );
        act(() => reconcilePending(C, new Map([[T, ['id']]])));
        expect(
            Object.keys(usePending.getState().byTable[`${C}:${T}`]!),
        ).toHaveLength(3);
        await act(async () => reject(fail({})));
        expect(useReview.getState().committing).toEqual({});
        expect(toast).toHaveBeenCalledWith(
            `Pending changes to removed columns of ${T} were dropped.`,
        );
        // The update writing `status` is gone; the delete and the (stripped) insert stay.
        expect(
            Object.keys(usePending.getState().byTable[`${C}:${T}`]!),
        ).toHaveLength(2);
    });

    it('keeps everything on a row mismatch and marks the failing row', async () => {
        api.commit.mockRejectedValue(fail({ index: 0, reason: 'changed' }));
        const onCommitted = openDialog();
        await screen.findAllByRole('listitem');
        fireEvent.click(
            screen.getByRole('button', { name: 'Commit 3 changes' }),
        );
        expect(await screen.findByRole('alert')).toHaveTextContent(
            'row changed since you loaded it',
        );
        expect(screen.getByRole('alert')).toHaveTextContent('id = 1');
        expect(usePending.getState().count(C, T).updated).toBe(1);
        expect(usePending.getState().errors[`${C}:${T}`]).toEqual({
            [ref1]: 'row changed since you loaded it',
        });
        expect(onCommitted).not.toHaveBeenCalled();
        expect(useReview.getState().open).not.toBeNull();
    });

    it('says a new row could not be added when its insert matched nothing', async () => {
        api.commit.mockRejectedValue(fail({ index: 2, reason: 'changed' }));
        openDialog();
        await screen.findAllByRole('listitem');
        fireEvent.click(
            screen.getByRole('button', { name: 'Commit 3 changes' }),
        );
        expect(await screen.findByRole('alert')).toHaveTextContent(
            'the new row could not be added',
        );
        expect(usePending.getState().errors[`${C}:${T}`]).toEqual({
            [insertRef]: 'the new row could not be added',
        });
    });

    it('shows a failure outside any statement at table level', async () => {
        api.commit.mockRejectedValue(
            fail({
                kind: 'query',
                message: 'deadlock detected',
                status: 422,
            }),
        );
        openDialog();
        await screen.findAllByRole('listitem');
        fireEvent.click(
            screen.getByRole('button', { name: 'Commit 3 changes' }),
        );
        expect(await screen.findByRole('alert')).toHaveTextContent(
            'deadlock detected',
        );
        expect(usePending.getState().errors[`${C}:${T}`]).toBeUndefined();
        expect(usePending.getState().count(C, T).inserted).toBe(1);
    });

    it('reviews again when changes are staged while it is open, and commits only what was shown', async () => {
        openDialog();
        await screen.findAllByRole('listitem');
        let resolve!: (v: unknown) => void;
        api.preview.mockReturnValueOnce(new Promise((r) => (resolve = r)));
        const id9 = { key: { id: 9 } };
        act(() =>
            usePending
                .getState()
                .setCell(
                    C,
                    T,
                    { ref: refOf(id9), id: id9, original: { status: 'a' } },
                    'status',
                    'b',
                ),
        );
        expect(
            screen.getByText('Changes were updated — reviewing again…'),
        ).toBeInTheDocument();
        expect(screen.getByRole('button', { name: /^Commit/ })).toBeDisabled();
        expect(api.preview).toHaveBeenCalledTimes(2);
        expect(api.preview.mock.calls[1][2]).toHaveLength(4);
        await act(async () =>
            resolve({
                statements: [
                    ...statements,
                    {
                        index: 3,
                        op: 'update',
                        sql: 'UPDATE 9',
                        target: 'id = 9',
                    },
                ],
            }),
        );
        api.commit.mockResolvedValue({
            applied: { inserted: 1, updated: 2, deleted: 1 },
        });
        fireEvent.click(
            screen.getByRole('button', { name: 'Commit 4 changes' }),
        );
        await waitFor(() =>
            expect(toast.success).toHaveBeenCalledWith('4 changes committed'),
        );
        expect(api.commit.mock.calls[0][2]).toHaveLength(4);
    });

    it('sends one commit however often Commit is clicked', async () => {
        api.commit.mockReturnValue(new Promise(() => undefined));
        openDialog();
        await screen.findAllByRole('listitem');
        const button = screen.getByRole('button', { name: 'Commit 3 changes' });
        fireEvent.click(button);
        fireEvent.click(button);
        expect(api.commit).toHaveBeenCalledTimes(1);
    });

    it('says the result is unknown when the commit got no answer', async () => {
        api.commit.mockRejectedValue(
            fail({
                kind: 'unknown',
                message: 'Could not apply the changes.',
                status: null,
            }),
        );
        openDialog();
        await screen.findAllByRole('listitem');
        fireEvent.click(
            screen.getByRole('button', { name: 'Commit 3 changes' }),
        );
        const alert = await screen.findByRole('alert');
        expect(alert).toHaveTextContent(
            'The result is unknown — refresh to check.',
        );
        expect(alert).not.toHaveTextContent('Nothing was changed');
        expect(usePending.getState().count(C, T).updated).toBe(1);
    });

    it('shows a preview that the server refuses', async () => {
        api.preview.mockRejectedValue(
            fail({
                kind: 'validation',
                message: 'Unknown column x',
                index: 0,
                status: 422,
            }),
        );
        openDialog();
        expect(await screen.findByRole('alert')).toHaveTextContent(
            'Unknown column x',
        );
        expect(
            screen.getByRole('button', { name: 'Commit 3 changes' }),
        ).toBeDisabled();
    });
});
