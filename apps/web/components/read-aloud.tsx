"use client";
import { Volume2, VolumeX } from "lucide-react";
import { useEffect, useState, useSyncExternalStore } from "react";
import { Button } from "./ui";

const noop = () => () => {};

/** Browser text-to-speech for low-literacy users. Hidden if the browser has no voices. */
export function ReadAloud({ text, lang, labels }: { text: string; lang: "hi" | "en"; labels: { play: string; stop: string } }) {
  const supported = useSyncExternalStore(noop, () => "speechSynthesis" in window, () => false);
  const [speaking, setSpeaking] = useState(false);
  useEffect(() => {
    return () => {
      if ("speechSynthesis" in window) window.speechSynthesis.cancel();
    };
  }, []);
  if (!supported) return null;
  return (
    <Button
      type="button"
      variant="secondary"
      onClick={() => {
        const synth = window.speechSynthesis;
        if (speaking) {
          synth.cancel();
          setSpeaking(false);
          return;
        }
        const u = new SpeechSynthesisUtterance(text);
        u.lang = lang === "hi" ? "hi-IN" : "en-IN";
        u.rate = 0.9;
        u.onend = () => setSpeaking(false);
        synth.speak(u);
        setSpeaking(true);
      }}
    >
      {speaking ? <VolumeX className="size-5" /> : <Volume2 className="size-5" />}
      {speaking ? labels.stop : labels.play}
    </Button>
  );
}
