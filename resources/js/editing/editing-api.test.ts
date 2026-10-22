import { afterEach, describe, expect, it, vi } from "vitest";
import { ChangeSetError, editingApi, type ChangeRequest } from "./editing-api";

const json = (status: number, body: unknown) =>
    new Response(JSON.stringify(body), {
        status,
        headers: { "Content-Type": "application/json" },
    });

const fetchMock = vi.fn();
vi.stubGlobal("fetch", fetchMock);

afterEach(() => fetchMock.mockReset());

const changes: ChangeRequest[] = [
    { op: "insert", values: { name: "x" } },
    {
        op: "update",
        id: { key: { id: 1 } },
        original: { name: "a" },
        values: { name: "b" },
    },
];

const failure = async (p: Promise<unknown>) => {
    try {
        await p;
    } catch (e) {
        expect(e).toBeInstanceOf(ChangeSetError);
        return (e as ChangeSetError).info;
    }
    throw new Error("expected a rejection");
};

describe("editingApi", () => {
    it("previews: posts preview true with the changes to the table endpoint", async () => {
        const statements = [
            {
                index: 1,
                op: "update",
                sql: 'UPDATE "t" SET "name" = \'b\' WHERE "id" = 1',
                target: "id = 1",
            },
            { index: 0, op: "insert", sql: "INSERT …", target: "new row" },
        ];
        fetchMock.mockResolvedValueOnce(json(200, { statements }));

        await expect(
            editingApi.preview(4, "my table", changes),
        ).resolves.toEqual({
            statements,
        });
        const [url, init] = fetchMock.mock.calls[0];
        expect(url).toBe("/api/c/4/tables/my%20table/changes");
        expect(init.method).toBe("POST");
        expect(JSON.parse(init.body)).toEqual({ preview: true, changes });
    });

    it("commits: posts preview false and returns the applied counts", async () => {
        fetchMock.mockResolvedValueOnce(
            json(200, { applied: { inserted: 1, updated: 1, deleted: 0 } }),
        );
        await expect(editingApi.commit(4, "t", changes)).resolves.toEqual({
            applied: { inserted: 1, updated: 1, deleted: 0 },
        });
        expect(JSON.parse(fetchMock.mock.calls[0][1].body).preview).toBe(false);
    });

    it("reports a 409 row mismatch with its index and reason", async () => {
        fetchMock.mockResolvedValueOnce(
            json(409, {
                error: {
                    kind: "row_mismatch",
                    message: "row changed since you loaded it",
                    index: 1,
                    reason: "changed",
                },
            }),
        );
        expect(await failure(editingApi.commit(4, "t", changes))).toEqual({
            kind: "row_mismatch",
            message: "row changed since you loaded it",
            index: 1,
            reason: "changed",
            sqlstate: null,
            status: 409,
        });
    });

    it("reports a 422 database error with its index, or a null index outside any statement", async () => {
        fetchMock.mockResolvedValueOnce(
            json(422, {
                error: {
                    kind: "constraint",
                    message: "duplicate key",
                    sqlstate: "23505",
                },
                index: 0,
            }),
        );
        expect(await failure(editingApi.commit(4, "t", changes))).toMatchObject(
            {
                kind: "constraint",
                message: "duplicate key",
                index: 0,
                sqlstate: "23505",
                status: 422,
            },
        );

        fetchMock.mockResolvedValueOnce(
            json(422, {
                error: { kind: "unknown", message: "could not commit" },
                index: null,
            }),
        );
        expect(await failure(editingApi.commit(4, "t", changes))).toMatchObject(
            {
                message: "could not commit",
                index: null,
            },
        );
    });

    it("takes the index of a refused change from its validation key", async () => {
        fetchMock.mockResolvedValueOnce(
            json(422, {
                message: 'The original value of "name" is missing.',
                errors: {
                    "changes.1.original": [
                        'The original value of "name" is missing.',
                    ],
                },
            }),
        );
        expect(
            await failure(editingApi.preview(4, "t", changes)),
        ).toMatchObject({
            kind: "validation",
            message: 'The original value of "name" is missing.',
            index: 1,
        });

        fetchMock.mockResolvedValueOnce(
            json(422, {
                message: "The change set is too large.",
                errors: { changes: ["The change set is too large."] },
            }),
        );
        expect(
            await failure(editingApi.preview(4, "t", changes)),
        ).toMatchObject({
            message: "The change set is too large.",
            index: null,
        });
    });

    it("reports a read-only connection", async () => {
        fetchMock.mockResolvedValueOnce(
            json(403, { message: "the connection is read-only" }),
        );
        expect(await failure(editingApi.commit(4, "t", changes))).toMatchObject(
            {
                kind: "read_only",
                message: "the connection is read-only",
                index: null,
                status: 403,
            },
        );
    });
});
