"use client";
import { Mic, Square } from "lucide-react";
import { useRef, useState } from "react";
import { transcribe } from "@/lib/ai-client";
import { Button } from "./ui";

/** Records a voice note and turns it into text with the /v1/stt endpoint (Whisper). */
export function VoiceRecorder({
  onText,
  labels,
  onAudio,
}: {
  onText: (text: string) => void;
  onAudio?: (blob: Blob) => void;
  labels: { idle: string; recording: string; working: string };
}) {
  const [state, setState] = useState<"idle" | "recording" | "working">("idle");
  const [error, setError] = useState<string | null>(null);
  const rec = useRef<MediaRecorder | null>(null);

  async function start() {
    setError(null);
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      const chunks: BlobPart[] = [];
      const r = new MediaRecorder(stream);
      r.ondataavailable = (e) => chunks.push(e.data);
      r.onstop = async () => {
        stream.getTracks().forEach((t) => t.stop());
        const blob = new Blob(chunks, { type: r.mimeType || "audio/webm" });
        onAudio?.(blob);
        setState("working");
        try {
          onText(await transcribe(blob));
        } catch (e) {
          setError(e instanceof Error ? e.message : String(e));
        } finally {
          setState("idle");
        }
      };
      rec.current = r;
      r.start();
      setState("recording");
    } catch {
      setError("Microphone not available");
    }
  }

  return (
    <div>
      <Button
        type="button"
        variant={state === "recording" ? "danger" : "secondary"}
        onClick={() => (state === "recording" ? rec.current?.stop() : start())}
        disabled={state === "working"}
        aria-pressed={state === "recording"}
      >
        {state === "recording" ? <Square className="size-5" /> : <Mic className="size-5" />}
        {state === "recording" ? labels.recording : state === "working" ? labels.working : labels.idle}
      </Button>
      {error && <p className="mt-1 text-sm text-danger">{error}</p>}
    </div>
  );
}
