import { toast } from 'sonner';
import { create } from 'zustand';
import { pinsApi, type Pin } from '@/lib/pins-api';

type State = {
    byConnection: Record<number, Pin[]>;
    load: (connectionId: number) => Promise<void>;
    toggle: (connectionId: number, table: string) => Promise<void>;
    reorder: (connectionId: number, tables: string[]) => Promise<void>;
    isPinned: (connectionId: number, table: string) => boolean;
};

let tempId = 0;
const nextTempId = () => --tempId;

export const usePins = create<State>()((set, get) => {
    const list = (c: number) => get().byConnection[c] ?? [];
    const put = (c: number, pins: Pin[]) =>
        set((s) => ({ byConnection: { ...s.byConnection, [c]: pins } }));

    // Operations on one connection run strictly one after another, each reading the
    // settled list when it starts. The first one on an idle connection starts synchronously
    // so its optimistic update is visible immediately.
    const tails = new Map<number, Promise<void>>();
    const queued = new Map<number, number>();
    const enqueue = (c: number, op: () => Promise<void>): Promise<void> => {
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
        c: number,
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
                        return list(c).map((p) => (p.id === temp.id ? pin : p));
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
