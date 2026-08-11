export function withPreviewRoute(path, search = globalThis.location?.search || "") {
  const preview = new URLSearchParams(search).get("preview");
  if (!preview) return path;

  const url = new URL(path, "http://local");
  url.searchParams.set("preview", preview);
  return `${url.pathname}${url.search}${url.hash}`;
}
