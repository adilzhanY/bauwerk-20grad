/**
 * The first image in a paste, or null. A screenshot or a copied image arrives as a file;
 * text, links and anything else are left to whoever else handles the paste.
 */
export function pastedImage(data: DataTransfer | null): File | null {
  if (!data) return null;
  for (const item of Array.from(data.items)) {
    if (item.kind !== "file" || !item.type.startsWith("image/")) continue;
    const file = item.getAsFile();
    if (!file) continue;
    // Copied images come without a useful name ("image.png"); the survey keeps one anyway.
    const extension = item.type.slice("image/".length) || "png";
    return file.name && file.name !== "image.png"
      ? file
      : new File([file], `pasted-photo.${extension}`, { type: item.type });
  }
  return null;
}
