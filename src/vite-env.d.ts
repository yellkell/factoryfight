/// <reference types="vite/client" />

// The house typeface (see ui/fonts.ts), imported for its URL.
declare module '*.woff2' {
  const src: string;
  export default src;
}
