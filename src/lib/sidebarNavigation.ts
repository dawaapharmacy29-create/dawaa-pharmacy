/** Match navigation state without treating an action query as the base page. */
export function basePath(path: string) { return path.split('?')[0]; }
export function activeItem(itemPath: string, pathname: string, search: string) {
  const base = basePath(itemPath);
  if (base === '/') return pathname === '/';
  if (base === '/team' && pathname.startsWith('/staff/')) return true;
  if (pathname !== base && !pathname.startsWith(`${base}/`)) return false;
  const expected = new URLSearchParams(itemPath.split('?')[1] || '');
  const actual = new URLSearchParams(search);
  if (!expected.size) return !actual.has('tab') && !actual.has('quickFollowup');
  return Array.from(expected).every(([key, value]) => actual.get(key) === value);
}
