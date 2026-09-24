"use client";
import { CATEGORIES, type Category, type TriageResponse } from "@janseva/shared";
import { Camera, Construction, Droplets, Lamp, LocateFixed, Trash2, Trees, Wand2 } from "lucide-react";
import { useTranslations } from "next-intl";
import { useState } from "react";
import { createReport } from "@/app/actions";
import { CATEGORY_COLORS, MapView } from "@/components/map";
import { Badge, Button, Card, ErrorBox, inputClass, Label } from "@/components/ui";
import { VoiceRecorder } from "@/components/voice-recorder";
import { Link } from "@/i18n/navigation";
import { newId } from "@/lib/local-store";
import { getBrowserSupabase } from "@/lib/supabase/client";

const ICONS: Record<Category, typeof Trash2> = {
  waste: Trash2,
  water_drainage: Droplets,
  roads: Construction,
  streetlights: Lamp,
  public_infra: Trees,
};

export function ReportForm({ uploadAs }: { uploadAs: string | null }) {
  const t = useTranslations("report");
  const tl = useTranslations("timeline");
  const c = useTranslations("common");
  const [category, setCategory] = useState<Category | null>(null);
  const [text, setText] = useState("");
  const [transcript, setTranscript] = useState<string | null>(null);
  const [photo, setPhoto] = useState<File | null>(null);
  const [loc, setLoc] = useState<{ lat: number; lng: number } | null>(null);
  const [locating, setLocating] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [done, setDone] = useState<TriageResponse | null>(null);

  function locate() {
    if (!navigator.geolocation) return;
    setLocating(true);
    navigator.geolocation.getCurrentPosition(
      (p) => {
        setLoc({ lat: p.coords.latitude, lng: p.coords.longitude });
        setLocating(false);
      },
      () => setLocating(false),
      { enableHighAccuracy: true, timeout: 10_000 },
    );
  }

  async function submit() {
    if (!loc) return;
    setBusy(true);
    setError(null);
    try {
      let photo_path: string | null = null;
      const supabase = getBrowserSupabase();
      if (photo && supabase && uploadAs) {
        const path = `${uploadAs}/${newId()}.${photo.name.split(".").pop() || "jpg"}`;
        const { error: upErr } = await supabase.storage.from("reports").upload(path, photo, { contentType: photo.type });
        if (!upErr) photo_path = path;
      }
      const res = await createReport({ text, category, location: loc, transcript, has_photo: Boolean(photo), photo_path });
      if (!res.ok) throw new Error(res.error);
      setDone(res.data);
    } catch (e) {
      setError(e instanceof Error ? e.message : c("error"));
    } finally {
      setBusy(false);
    }
  }

  if (done) {
    return (
      <Card className="space-y-3 border-green/50">
        <p className="text-lg font-semibold">
          {done.merged ? t("merged", { count: done.cluster.report_count }) : t("created")}
        </p>
        <div className="flex flex-wrap gap-2">
          <Badge tone="saffron">{t(`categories.${done.report.category}`)}</Badge>
          <Badge>{t("severity")}: {done.report.severity}/5</Badge>
          <Badge tone="green">{tl(`status.${done.report.status}`)}</Badge>
          {done.report.flags.filter((f) => f in { photo_needed_for_high_severity: 1, safety_risk: 1, long_pending: 1, vague: 1 }).map((f) => (
            <Badge key={f} tone="warn">{t(`flags.${f}`)}</Badge>
          ))}
        </div>
        <div className="flex gap-2">
          <Link href={`/report/${done.report.id}`} className="rounded-xl bg-saffron px-4 py-3 font-semibold text-saffron-ink">
            {t("open")}
          </Link>
          <Button variant="secondary" onClick={() => { setDone(null); setText(""); setPhoto(null); setTranscript(null); }}>
            {t("title")}
          </Button>
        </div>
      </Card>
    );
  }

  return (
    <Card className="space-y-5">
      <div>
        <Label>{t("category")}</Label>
        <div className="grid grid-cols-3 gap-2 sm:grid-cols-6">
          <CatButton active={category === null} onClick={() => setCategory(null)} label={t("autoDetect")} icon={Wand2} />
          {CATEGORIES.map((cat) => (
            <CatButton key={cat} active={category === cat} onClick={() => setCategory(cat)} label={t(`categories.${cat}`)} icon={ICONS[cat]} color={CATEGORY_COLORS[cat]} />
          ))}
        </div>
      </div>

      <div>
        <Label htmlFor="describe">{t("describe")}</Label>
        <textarea id="describe" rows={3} value={text} onChange={(e) => setText(e.target.value)} placeholder={t("describePlaceholder")} className={inputClass} />
        <div className="mt-2">
          <VoiceRecorder
            onText={(tx) => {
              setTranscript(tx);
              setText((prev) => (prev ? `${prev} ${tx}` : tx));
            }}
            labels={{ idle: t("voiceNote"), recording: t("recording"), working: t("transcribing") }}
          />
        </div>
      </div>

      <div>
        <Label htmlFor="photo">{t("photo")}</Label>
        <label className="flex min-h-12 cursor-pointer items-center gap-2 rounded-xl border border-dashed border-line px-4 py-3 hover:border-saffron">
          <Camera className="size-5 text-saffron" />
          <span className="truncate">{photo ? photo.name : t("photo")}</span>
          <input id="photo" type="file" accept="image/*" capture="environment" className="sr-only" onChange={(e) => setPhoto(e.target.files?.[0] ?? null)} />
        </label>
        <p className="mt-1 text-xs text-muted">{t("photoHint")}</p>
      </div>

      <div>
        <Label>{t("location")}</Label>
        <Button type="button" variant="secondary" onClick={locate} disabled={locating}>
          <LocateFixed className="size-5" /> {locating ? t("locating") : t("useGps")}
        </Button>
        <p className="my-2 text-xs text-muted">{t("tapMap")}</p>
        <MapView
          center={loc ? [loc.lat, loc.lng] : undefined}
          zoom={loc ? 16 : 13}
          onPick={(lat, lng) => setLoc({ lat, lng })}
          pins={loc ? [{ id: "me", lat: loc.lat, lng: loc.lng, label: t("location"), color: "#22a447", selected: true }] : []}
          height={260}
        />
        {loc && <p className="mt-1 text-xs text-muted">{loc.lat.toFixed(5)}, {loc.lng.toFixed(5)}</p>}
      </div>

      {error && <ErrorBox>{error}</ErrorBox>}
      <Button className="w-full text-lg" onClick={submit} disabled={busy || !loc || (!text.trim() && !category)}>
        {busy ? c("loading") : t("submit")}
      </Button>
    </Card>
  );
}

function CatButton({ active, onClick, label, icon: Icon, color }: { active: boolean; onClick: () => void; label: string; icon: typeof Trash2; color?: string }) {
  return (
    <button
      type="button"
      onClick={onClick}
      aria-pressed={active}
      className={`flex min-h-20 flex-col items-center justify-center gap-1 rounded-xl border p-2 text-center text-xs ${active ? "border-saffron bg-saffron/15" : "border-line bg-surface-2"}`}
    >
      <Icon className="size-6" style={color ? { color } : undefined} aria-hidden />
      {label}
    </button>
  );
}
