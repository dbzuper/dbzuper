import { toast } from 'sonner';
import { create } from 'zustand';
import { claimSevenWish, SEVEN, SEVEN_LINE } from '@/lib/easter-eggs';
import { pinsApi, type Pin } from '@/lib/pins-api';
import type { WorkspaceRef } from '@/types/connection';

type State = {
    byConnection: Record<WorkspaceRef, Pin[]>;
    load: (connectionId: WorkspaceRef) => Promise<void>;
    toggle: (connectionId: WorkspaceRef, table: string) => Promise<void>;
    reorder: (connectionId: WorkspaceRef, tables: string[]) => Promise<void>;
    isPinned: (connectionId: WorkspaceRef, table: string) => boolean;
};

let tempId = 0;
const nextTempId = () => --tempId;

export const usePins = create<State>()((set, get) => {
    const list = (c: WorkspaceRef) => get().byConnection[c] ?? [];
    const put = (c: WorkspaceRef, pins: Pin[]) =>
        set((s) => ({ byConnection: { ...s.byConnection, [c]: pins } }));

    // Operations on one connection run strictly one after another, each reading the
    // settled list when it starts. The first one on an idle connection starts synchronously
    // so its optimistic update is visible immediately.
    const tails = new Map<WorkspaceRef, Promise<void>>();
    const queued = new Map<WorkspaceRef, number>();
    const enqueue = (
        c: WorkspaceRef,
        op: () => Promise<void>,
    ): Promise<void> => {
        const waiting = queued.get(c) ?? 0;
        queued.set(c, waiting + 1);
        const run = () =>
            op().finally(() => queued.set(c, (queued.get(c) ?? 1) - 1));
        const next = waiting === 0 ? run() : tails.get(c)!.then(run);
        tails.set(
            c,
            next.catch(() => undefined),
        );
        return next;
    };

    const attempt = (
        c: WorkspaceRef,
        plan: () => { optimistic: Pin[]; run: () => Promise<Pin[] | null> },
    ) =>
        enqueue(c, async () => {
            const before = list(c);
            const { optimistic, run } = plan();
            put(c, optimistic);
            try {
                const result = await run();
                if (result) put(c, result);
            } catch {
                put(c, before);
                toast.error('Could not update pins.');
            }
        });

    return {
        byConnection: {},
        load: async (c) => {
            try {
                put(c, (await pinsApi.list(c)).pins);
            } catch {
                // Pins are a convenience: the sidebar works without them.
            }
        },
        isPinned: (c, table) => list(c).some((p) => p.table === table),
        toggle: (c, table) =>
            attempt(c, () => {
                const found = list(c).find((p) => p.table === table);
                if (found)
                    return {
                        optimistic: list(c).filter((p) => p.id !== found.id),
                        run: async () => {
                            await pinsApi.remove(c, found.id);
                            return null;
                        },
                    };
                const temp: Pin = {
                    id: nextTempId(),
                    table,
                    position: list(c).length + 1,
                };
                return {
                    optimistic: [...list(c), temp],
                    run: async () => {
                        const { pin } = await pinsApi.add(c, table);
                        const next = list(c).map((p) =>
                            p.id === temp.id ? pin : p,
                        );
                        if (next.length === SEVEN && claimSevenWish())
                            toast(SEVEN_LINE);
                        return next;
                    },
                };
            }),
        reorder: (c, tables) =>
            attempt(c, () => {
                const byTable = new Map(list(c).map((p) => [p.table, p]));
                const ordered = tables
                    .map((t) => byTable.get(t))
                    .filter((p): p is Pin => !!p);
                return {
                    optimistic: ordered,
                    run: async () =>
                        (
                            await pinsApi.reorder(
                                c,
                                ordered.map((p) => p.id),
                            )
                        ).pins,
                };
            }),
    };
});
