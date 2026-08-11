// Module-resolution shim so `node --test` can import the app's TypeScript
// modules directly: maps the tsconfig "@/*" alias to src/*, and retries
// extensionless / exports-map specifiers with .ts/.tsx/.js suffixes, which
// Node's native type stripping does not resolve on its own.
import { pathToFileURL } from 'node:url';
import path from 'node:path';
import fs from 'node:fs';

const SRC_ROOT = path.resolve(path.dirname(new URL(import.meta.url).pathname), '../src');

function existingFile(candidate) {
  return fs.existsSync(candidate) && fs.statSync(candidate).isFile() ? candidate : null;
}

function resolveWithExtensions(basePath) {
  return (
    existingFile(basePath) ??
    existingFile(`${basePath}.ts`) ??
    existingFile(`${basePath}.tsx`) ??
    existingFile(path.join(basePath, 'index.ts'))
  );
}

export async function resolve(specifier, context, nextResolve) {
  if (specifier.startsWith('@/')) {
    const resolved = resolveWithExtensions(path.join(SRC_ROOT, specifier.slice(2)));
    if (resolved) {
      return nextResolve(pathToFileURL(resolved).href, context);
    }
  }

  try {
    return await nextResolve(specifier, context);
  } catch (error) {
    if (error?.code !== 'ERR_MODULE_NOT_FOUND') {
      throw error;
    }
    if (specifier.startsWith('./') || specifier.startsWith('../')) {
      const parentPath = context.parentURL ? new URL(specifier, context.parentURL).pathname : null;
      const resolved = parentPath ? resolveWithExtensions(parentPath) : null;
      if (resolved) {
        return nextResolve(pathToFileURL(resolved).href, context);
      }
    } else {
      // Bare specifiers like "next/server" whose exports map only lists "./server.js".
      try {
        return await nextResolve(`${specifier}.js`, context);
      } catch {
        throw error;
      }
    }
    throw error;
  }
}
