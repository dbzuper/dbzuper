import { ApiError } from '@/lib/http';
import { dbErrorFrom } from '@/lib/workspace-api';
import type { ConfirmationPayload, DbErrorPayload } from '@/types/schema';
import { queryApi, type RunResponse, type StatementInput } from './query-api';
import type { WorkspaceRef } from '@/types/connection';

export type ConfirmAnswer = { confirmed: true; typed?: string } | null;

export type RunOutcome =
    | RunResponse
    | { cancelled: true }
    | { error: DbErrorPayload };

/** Maps a failed query call to an outcome; validation 422s surface their first message. */
export function outcomeFromError(e: unknown): RunOutcome {
    if ((e as { name?: string } | null)?.name === 'AbortError')
        return { cancelled: true };
    if (e instanceof ApiError && e.status === 422) {
        const errors = (e.body as { errors?: Record<string, string[]> } | null)
            ?.errors;
        const first = errors ? Object.values(errors).flat()[0] : undefined;
        if (typeof first === 'string')
            return {
                error: {
                    kind: 'validation',
                    message: first,
                    sqlstate: null,
                    reason: null,
                },
            };
    }
    return { error: dbErrorFrom(e, 'The query could not be run.') };
}

export async function runWithConfirmations(args: {
    connectionId: WorkspaceRef;
    statements: string[];
    maxRows: number;
    signal: AbortSignal;
    confirm: (c: ConfirmationPayload, sql: string) => Promise<ConfirmAnswer>;
}): Promise<RunOutcome> {
    const inputs: StatementInput[] = args.statements.map((sql) => ({ sql }));
    // Each statement needs at most one confirmation, so the loop is bounded.
    for (let attempt = 0; attempt <= inputs.length; attempt++) {
        try {
            return await queryApi.run(
                args.connectionId,
                inputs,
                args.maxRows,
                args.signal,
            );
        } catch (e) {
            const body =
                e instanceof ApiError
                    ? (e.body as { confirmation?: ConfirmationPayload } | null)
                    : null;
            if (
                e instanceof ApiError &&
                e.status === 409 &&
                body?.confirmation
            ) {
                const c = body.confirmation;
                const answer = await args.confirm(
                    c,
                    inputs[c.statement_index].sql,
                );
                if (!answer || args.signal.aborted) return { cancelled: true };
                inputs[c.statement_index] = {
                    ...inputs[c.statement_index],
                    confirmed: true,
                    ...(answer.typed !== undefined
                        ? { typed: answer.typed }
                        : {}),
                };
                continue;
            }
            return outcomeFromError(e);
        }
    }
    return {
        error: {
            kind: 'unknown',
            message: 'Too many confirmation rounds.',
            sqlstate: null,
            reason: null,
        },
    };
}
