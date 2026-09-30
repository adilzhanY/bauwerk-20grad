import { useEffect, useState } from "react";
import type { Size } from "@/components/photo-editor/types";

/** Current size of an element, kept up to date by a ResizeObserver. */
export function useElementSize(ref: React.RefObject<HTMLElement | null>): Size {
  const [size, setSize] = useState<Size>({ width: 0, height: 0 });

  useEffect(() => {
    const element = ref.current;
    if (!element) return;
    const update = () => {
      setSize({ width: element.clientWidth, height: element.clientHeight });
    };
    update();
    const observer = new ResizeObserver(update);
    observer.observe(element);
    return () => {
      observer.disconnect();
    };
  }, [ref]);

  return size;
}
