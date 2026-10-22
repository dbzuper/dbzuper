import { ApiError, apiFetch } from "@/lib/http";
import { dbErrorFrom, type RowIdentity } from "@/lib/workspace-api";
import type { QueryCell } from "@/types/schema";

/** One change as POST /api/c/{connection}/tables/{table}/changes takes it (see TableChangesRequest). */
export type ChangeRequest =
    | { op: "insert"; values: Record<string, string | null> }
    | {
          op: "update";
          id: RowIdentity;
          original: Record<string, QueryCell>;
          values: Record<string, string | null>;
          shortened?: string[];
      }
    | {
          op: "delete";
          id: RowIdentity;
          original: Record<string, QueryCell>;
          shortened?: string[];
      };

export type PreviewStatement = {
    /** The change's position in the request. */
    index: number;
    op: "insert" | "update" | "delete";
    sql: string;
    /** How the row is targeted, e.g. `id = 3`, `ctid (0,1)`, `matched by all values`, `new row`. */
    target: string;
};
export type PreviewResponse = { statements: PreviewStatement[] };
export type CommitResponse = {
    applied: { inserted: number; updated: number; deleted: number };
};

/** Why a change set was refused or rolled back; `index` is the failing change's request position, when known. */
export type ChangeSetErrorInfo = {
    kind: string;
    message: string;
    index: number | null;
    /** `changed` / `multiple` for a row mismatch. */
    reason: string | null;
    sqlstate: string | null;
    status: number | null;
};

export class ChangeSetError extends Error {
    constructor(public readonly info: ChangeSetErrorInfo) {
        super(info.message);
        this.name = "ChangeSetError";
    }
}

const changesUrl = (connectionId: number, table: string) =>
    `/api/c/${connectionId}/tables/${encodeURIComponent(table)}/changes`;

/** The index of the first `changes.N…` validation key, else null. */
function validationIndex(body: unknown): number | null {
    const errors =
        body && typeof body === "object"
            ? (body as { errors?: unknown }).errors
            : null;
    if (!errors || typeof errors !== "object") return null;
    for (const key of Object.keys(errors)) {
        const match = /^changes\.(\d+)(\.|$)/.exec(key);
        if (match) return Number(match[1]);
    }
    return null;
}

export function changeSetErrorFrom(e: unknown): ChangeSetErrorInfo {
    const status = e instanceof ApiError ? e.status : null;
    const body = e instanceof ApiError ? e.body : null;
    if (status === 403) {
        const message =
            body && typeof body === "object" && "message" in body
                ? String((body as { message: unknown }).message)
                : "";
        return {
            kind: "read_only",
            message: message || "This connection is read-only.",
            index: null,
            reason: null,
            sqlstate: null,
            status,
        };
    }
    const db = dbErrorFrom(e, "Could not apply the changes.");
    const outer =
        body && typeof body === "object"
            ? (body as { index?: unknown; error?: { index?: unknown } })
            : {};
    // 409 row_mismatch carries the index inside `error`; 422 ChangeFailed beside it (null outside any statement).
    const raw = outer.error?.index ?? outer.index;
    const index =
        typeof raw === "number"
            ? raw
            : status === 422 && db.kind === "validation"
              ? validationIndex(body)
              : null;
    return {
        kind: db.kind,
        message: db.message,
        index,
        reason: db.reason,
        sqlstate: db.sqlstate,
        status,
    };
}

async function send<T>(
    connectionId: number,
    table: string,
    changes: ChangeRequest[],
    preview: boolean,
): Promise<T> {
    try {
        return await apiFetch<T>(changesUrl(connectionId, table), {
            method: "POST",
            body: { preview, changes },
        });
    } catch (e) {
        throw new ChangeSetError(changeSetErrorFrom(e));
    }
}

export const editingApi = {
    /** The statements the server would run, with literals inlined, in execution order. Nothing runs. */
    preview: (connectionId: number, table: string, changes: ChangeRequest[]) =>
        send<PreviewResponse>(connectionId, table, changes, true),
    /** Runs every change in one transaction; rejects with ChangeSetError (nothing applied) on any failure. */
    commit: (connectionId: number, table: string, changes: ChangeRequest[]) =>
        send<CommitResponse>(connectionId, table, changes, false),
};
