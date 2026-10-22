import { act, fireEvent, render, screen, within } from "@testing-library/react";
import { beforeEach, describe, expect, it } from "vitest";
import { refOf, usePending } from "@/editing/pending-store";
import { useReview } from "@/editing/review-store";
import { PendingBar } from "./pending-bar";

const C = 1;
const T = "orders";

function stage() {
    const s = usePending.getState();
    const id = { key: { id: 1 } };
    s.setCell(C, T, { ref: refOf(id), id, original: { a: "1" } }, "a", "2");
    s.addRow(C, T);
    s.addRow(C, T);
    const id2 = { key: { id: 2 } };
    s.markDelete(C, T, { ref: refOf(id2), id: id2, original: {} });
}

beforeEach(() => {
    usePending.setState({ byTable: {}, errors: {} });
    useReview.setState({ open: null, nonce: 0 });
});

describe("PendingBar", () => {
    it("shows nothing without pending changes", () => {
        const { container } = render(<PendingBar connectionId={C} table={T} />);
        expect(container).toBeEmptyDOMElement();
    });

    it("counts the pending changes by kind", () => {
        stage();
        render(<PendingBar connectionId={C} table={T} />);
        expect(screen.getByRole("status")).toHaveTextContent(
            "4 pending changes · 2 new · 1 edited · 1 deleted",
        );
        act(() => {
            usePending.getState().addRow(C, T);
        });
        expect(screen.getByRole("status")).toHaveTextContent(
            "5 pending changes · 3 new",
        );
    });

    it("discards only after confirming", () => {
        stage();
        render(<PendingBar connectionId={C} table={T} />);
        fireEvent.click(screen.getByRole("button", { name: "Discard" }));
        expect(
            screen.getByRole("dialog", {
                name: "Discard 4 pending changes to `orders`?",
            }),
        ).toBeInTheDocument();
        fireEvent.click(screen.getByRole("button", { name: "Keep changes" }));
        expect(screen.queryByRole("dialog")).toBeNull();
        expect(usePending.getState().count(C, T).inserted).toBe(2);
        fireEvent.click(screen.getByRole("button", { name: "Discard" }));
        fireEvent.click(
            within(screen.getByRole("dialog")).getByRole("button", {
                name: "Discard",
            }),
        );
        expect(usePending.getState().byTable[`${C}:${T}`]).toBeUndefined();
        expect(screen.queryByRole("status")).toBeNull();
    });

    it("opens Review & commit for its table", () => {
        stage();
        render(<PendingBar connectionId={C} table={T} />);
        fireEvent.click(
            screen.getByRole("button", { name: "Review & commit…" }),
        );
        expect(useReview.getState().open).toEqual({
            connectionId: C,
            table: T,
        });
    });
});
