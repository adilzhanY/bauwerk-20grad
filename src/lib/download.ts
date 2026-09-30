export function downloadFile(content: BlobPart, name: string, type: string): void {
  const blob = content instanceof Blob ? content : new Blob([content], { type });
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement("a");
  anchor.href = url;
  anchor.download = name;
  anchor.click();
  URL.revokeObjectURL(url);
}

export function buildingFileName(name: string, extension: string, dated = true): string {
  const slug =
    name
      .toLowerCase()
      .replace(/[^a-z0-9äöüß]+/g, "-")
      .replace(/^-|-$/g, "") || "building";
  const date = dated ? `-${new Date().toISOString().slice(0, 10)}` : "";
  return `bauwerk-${slug}${date}.${extension}`;
}
