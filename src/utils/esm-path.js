// src/utils/esm-path.js
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';

export const getESMPath = (importMetaUrl) => {
  const __filename = fileURLToPath(importMetaUrl);
  const __dirname = dirname(__filename);
  return { __filename, __dirname };
};

export const resolveESMPath = (importMetaUrl, ...paths) => {
  const { __dirname } = getESMPath(importMetaUrl);
  return join(__dirname, ...paths);
};

export default getESMPath;