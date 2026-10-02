/** Whether `accept` (a file input's list) takes the file. No list takes everything. */
export function accepts(file: File, accept: string | undefined): boolean {
  if (!accept) return true;
  const name = file.name.toLowerCase();
  const type = file.type.toLowerCase();
  return accept
    .split(",")
    .map((a) => a.trim().toLowerCase())
    .filter(Boolean)
    .some((a) =>
      a.startsWith(".")
        ? name.endsWith(a)
        : a.endsWith("/*")
          ? type.startsWith(a.slice(0, -1))
          : type === a,
    );
}
