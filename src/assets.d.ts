// Vite turns `import x from 'file?url'` into the URL the file is served from.
declare module '*?url' {
  const url: string;
  export default url;
}
