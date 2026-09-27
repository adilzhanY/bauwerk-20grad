import { useEffect, useRef, useState } from "react";
import { useT } from "@/i18n/useT";
import { errorText } from "../../api/errors.ts";
import { DETECTION_DONE_MS } from "./constants.ts";
import type { DetectionStage, DetectionState } from "./types.ts";

/** A job reports whether it finished; false means it was aborted or had nothing to do. */
type Job = (signal: AbortSignal, startedAt: number) => Promise<boolean>;

/**
 * The progress state of lod2-vision jobs. One job at a time: starting a new one aborts the
 * one before. A finished job shows "done" for a moment, a failed one keeps its message and
 * remembers which stage it failed in, and a job whose editor has gone is aborted.
 */
export function useDetectionJob() {
  const [detection, setDetection] = useState<DetectionState | null>(null);
  const abortRef = useRef<AbortController | null>(null);
  const t = useT();

  useEffect(() => () => abortRef.current?.abort(), []);

  const run = async (first: DetectionStage, job: Job) => {
    abortRef.current?.abort();
    const controller = new AbortController();
    abortRef.current = controller;
    const startedAt = performance.now();
    setDetection({ stage: first, startedAt });
    try {
      const finished = await job(controller.signal, startedAt);
      if (!finished || controller.signal.aborted) return;
      const endedAt = performance.now();
      setDetection((current) => ({
        stage: "done",
        startedAt,
        endedAt,
        baseHidden: current?.baseHidden,
      }));
      setTimeout(() => {
        setDetection((current) => (current?.stage === "done" ? null : current));
      }, DETECTION_DONE_MS);
    } catch (error) {
      if (controller.signal.aborted) return;
      const message = errorText(error, t);
      const endedAt = performance.now();
      setDetection((current) => ({
        stage: "failed",
        startedAt,
        endedAt,
        message,
        failedAt: current?.stage,
      }));
    }
  };

  /** Stop the running job, if any, and hide the progress card. */
  const cancel = () => {
    abortRef.current?.abort();
    setDetection(null);
  };

  /** True while a job is at work, for the scan effect and for disabling Apply. */
  const scanning = detection !== null && detection.stage !== "done" && detection.stage !== "failed";

  return { detection, setDetection, run, cancel, scanning };
}
