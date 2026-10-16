/** A card's centre and size, in viewport pixels. */
export type CardBox = {
    key: string;
    x: number;
    y: number;
    width: number;
    height: number;
};

/**
 * Vertical offsets (px, to add to each card's y) that leave a minimum `gap` between any two cards
 * that share horizontal space. Only y changes and only downwards, so graph nodes never move; cards
 * are settled top to bottom, each pushed below whatever it still overlaps. Cards that already clear
 * each other get 0.
 */
export function deOverlapCards(
    boxes: CardBox[],
    gap: number,
): Map<string, number> {
    const order = [...boxes].sort(
        (a, b) => a.y - b.y || (a.key < b.key ? -1 : a.key > b.key ? 1 : 0),
    );
    const placed: CardBox[] = [];
    const offsets = new Map<string, number>();

    for (const box of order) {
        let y = box.y;
        let moved = true;
        while (moved) {
            moved = false;
            for (const other of placed) {
                const sharesColumn =
                    Math.abs(box.x - other.x) < (box.width + other.width) / 2;
                const needed = (box.height + other.height) / 2 + gap;
                if (
                    sharesColumn &&
                    y - other.y < needed &&
                    other.y - y < needed
                ) {
                    // Only a strictly lower y counts as a move: float round-off can leave
                    // (other.y + needed) - other.y a hair under `needed`, and re-assigning the
                    // same y forever would hang the page.
                    const pushed = other.y + needed;
                    if (pushed > y) {
                        y = pushed;
                        moved = true;
                    }
                }
            }
        }
        placed.push({ ...box, y });
        offsets.set(box.key, y - box.y);
    }
    return offsets;
}
