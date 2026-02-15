import { fileURLToPath } from 'url';
import { dirname, join } from 'path';

export function getDirname(importMetaUrl) {
    return dirname(fileURLToPath(importMetaUrl));
}

export function getFilename(importMetaUrl) {
    return fileURLToPath(importMetaUrl);
}

export function joinPaths(basePath, ...paths) {
    return join(basePath, ...paths);
}

// Export untuk CommonJS compatibility
export default {
    getDirname,
    getFilename,
    joinPaths
};