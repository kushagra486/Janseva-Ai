import { setRequestLocale } from "next-intl/server";
import { Card, PageHeader } from "@/components/ui";

// Privacy notice (DPDP Act, 2023).
const SECTIONS = [
  {
    title: "What we collect",
    body: "Only what you choose to give: notice photos or text you scan, deadlines you save, reports you file (text, photo, location) and your email if you sign in.",
  },
  {
    title: "Why",
    body: "To explain notices, remind you before deadlines, route civic problems to the right department and show you their status.",
  },
  {
    title: "How we protect it",
    body: "Aadhaar, phone, PAN and email patterns are masked before any AI model sees your text. Files are kept in private storage. Database rules let you see only your own data; officers see reports from their ward only. Every action on a report is logged.",
  },
  {
    title: "Your rights",
    body: "You can see, correct or delete your data and withdraw consent at any time from your account, or by writing to the grievance officer listed on the site.",
  },
  {
    title: "AI guidance",
    body: "Explanations are guidance, not legal advice. Eligibility for schemes is decided by published rules, not by the AI. Always check the original notice and official source.",
  },
];

export default async function PrivacyPage({ params }: { params: Promise<{ locale: string }> }) {
  const { locale } = await params;
  setRequestLocale(locale);
  return (
    <>
      <PageHeader title="Privacy notice" subtitle="Digital Personal Data Protection Act, 2023" />
      <div className="space-y-3">
        {SECTIONS.map((s) => (
          <Card key={s.title}>
            <h2 className="font-semibold">{s.title}</h2>
            <p className="mt-1 text-muted">{s.body}</p>
          </Card>
        ))}
      </div>
    </>
  );
}
