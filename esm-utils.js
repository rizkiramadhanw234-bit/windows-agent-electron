import { fileURLToPath } from 'url';
import { dirname, join } from 'path';

export const getDirname = (importMetaUrl) => dirname(fileURLToPath(importMetaUrl));
export const getFilename = (importMetaUrl) => fileURLToPath(importMetaUrl);
export const resolvePath = (importMetaUrl, ...paths) => {
  const baseDir = dirname(fileURLToPath(importMetaUrl));
  return join(baseDir, ...paths);
};