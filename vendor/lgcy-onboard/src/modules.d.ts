// HTML pages and the SQL schema are bundled as text (see scripts/bundle.mjs).
declare module '*.html' {
  const text: string;
  export default text;
}
declare module '*.sql' {
  const text: string;
  export default text;
}
