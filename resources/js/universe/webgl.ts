let cached: boolean | null = null;

/**
 * Sigma 4 needs WebGL2 and touches the `WebGL2RenderingContext` global at
 * import time, so both the global and a real `webgl2` context are required.
 * The probe runs once per page load so it never leaks a context per call.
 */
export function hasWebGL(): boolean {
    if (cached !== null) return cached;
    cached = probe();
    return cached;
}

function probe(): boolean {
    if (typeof WebGL2RenderingContext === 'undefined') return false;
    try {
        const canvas = document.createElement('canvas');
        const gl = canvas.getContext('webgl2');
        if (!gl) return false;
        gl.getExtension('WEBGL_lose_context')?.loseContext();
        return true;
    } catch {
        return false;
    }
}
