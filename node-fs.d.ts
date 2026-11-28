// The one Node API vite.config.ts uses (copying the scanner's OCR files). The app's tsconfig has no
// Node types, so it's declared here instead of adding @types/node for the whole project.
declare module 'node:fs' {
  export function readFileSync(path: string): Uint8Array;
}
