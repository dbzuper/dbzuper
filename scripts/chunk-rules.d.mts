export const chunkModulesFile: string;
export const banned: string[];
export function bannedPackage(id: string): string | null;
export function entryKeys(manifest: Record<string, unknown>): string[];
export function findProblems(
    manifest: Record<
        string,
        { file: string; isEntry?: boolean; imports?: string[] }
    >,
    modules: Record<string, string[]>,
): string[];
export const lazyFontEntry: string;
export function findFontProblems(
    manifest: Record<
        string,
        {
            file: string;
            isEntry?: boolean;
            imports?: string[];
            css?: string[];
        }
    >,
    readCss: (file: string) => string,
): string[];
