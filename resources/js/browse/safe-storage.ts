export const safeStorage = {
    getItem: (name: string) => {
        try {
            return localStorage.getItem(name);
        } catch {
            return null;
        }
    },
    setItem: (name: string, value: string) => {
        try {
            localStorage.setItem(name, value);
        } catch {
            // Quota or blocked storage must never break typing.
        }
    },
    removeItem: (name: string) => {
        try {
            localStorage.removeItem(name);
        } catch {
            // ignore
        }
    },
};
