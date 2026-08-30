import { useCallback, useEffect, useRef, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { PARALLEL_WRITERS } from "./story-rules";
import { finishPart, planPart, writeStoryChunk } from "./stories.functions";

export type WriterState = {
  running: boolean;
  phase: string;
  done: number;
  total: number;
  words: number;
  error: string | null;
};

export function useStoryWriter(partId: string | null, onUpdate: () => void) {
  const [state, setState] = useState<WriterState>({
    running: false,
    phase: "रुका हुआ",
    done: 0,
    total: 0,
    words: 0,
    error: null,
  });
  const stopRef = useRef(false);
  const busyRef = useRef(false);

  const stop = useCallback(() => {
    stopRef.current = true;
    setState((s) => ({ ...s, running: false, phase: "रोका गया" }));
  }, []);

  const run = useCallback(async () => {
    if (!partId || busyRef.current) return;
    busyRef.current = true;
    stopRef.current = false;
    setState((s) => ({ ...s, running: true, error: null, phase: "शुरू हो रहा है" }));

    try {
      for (let guard = 0; guard < 400; guard++) {
        if (stopRef.current) break;

        const { data: part } = await supabase
          .from("story_parts")
          .select("id, status")
          .eq("id", partId)
          .single();
        if (!part) throw new Error("पार्ट नहीं मिला");

        if (part.status === "complete") {
          setState((s) => ({ ...s, running: false, phase: "पूरा हो गया" }));
          break;
        }

        if (part.status === "planning") {
          setState((s) => ({ ...s, phase: "सारांश पढ़कर प्लान बनाया जा रहा है" }));
          await planPart({ data: { partId } });
          onUpdate();
          continue;
        }

        const { data: chunks } = await supabase
          .from("story_chunks")
          .select("id, status, word_count")
          .eq("part_id", partId)
          .order("chunk_index");
        const list = chunks ?? [];
        const pending = list.filter((c) => c.status !== "done");
        const words = list.reduce((sum, c) => sum + c.word_count, 0);
        setState((s) => ({
          ...s,
          total: list.length,
          done: list.length - pending.length,
          words,
          phase:
            pending.length === 0
              ? "जाँच हो रही है"
              : `अध्याय लिखे जा रहे हैं (${list.length - pending.length} में से ${list.length})`,
        }));

        if (pending.length === 0) {
          const result = await finishPart({ data: { partId } });
          onUpdate();
          if (result.status === "complete") {
            setState((s) => ({
              ...s,
              running: false,
              words: result.wordCount,
              phase: "पूरा हो गया",
            }));
            break;
          }
          continue;
        }

        const batch = pending.slice(0, PARALLEL_WRITERS);
        await Promise.all(
          batch.map((c, i) =>
            writeStoryChunk({ data: { chunkId: c.id, keyIndex: i % PARALLEL_WRITERS } }).catch(
              (err: unknown) => {
                console.error("chunk failed", err);
              },
            ),
          ),
        );
        onUpdate();
      }
    } catch (err) {
      setState((s) => ({
        ...s,
        running: false,
        error: err instanceof Error ? err.message : String(err),
        phase: "गड़बड़ हुई",
      }));
    } finally {
      busyRef.current = false;
    }
  }, [partId, onUpdate]);

  useEffect(() => {
    return () => {
      stopRef.current = true;
    };
  }, []);

  return { state, run, stop };
}
