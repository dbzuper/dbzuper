export type Size = { width: number; height: number };

/**
 * The container's new whole-pixel size, or null when it is unchanged. Sub-pixel jitter from
 * fractional layouts rounds away, so it never triggers a resize.
 */
export function changedSize(
    previous: Size | null,
    width: number,
    height: number,
): Size | null {
    const next = { width: Math.round(width), height: Math.round(height) };
    if (
        previous &&
        previous.width === next.width &&
        previous.height === next.height
    )
        return null;
    return next;
}
