import { useEffect } from "react";
import type { BufferGeometry } from "three";

/** Releases a geometry when it is replaced or its component unmounts. */
export function useDisposableGeometry(geometry: BufferGeometry | null): void {
  useEffect(
    () => () => {
      geometry?.dispose();
    },
    [geometry],
  );
}
