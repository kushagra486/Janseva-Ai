import { setRequestLocale } from "next-intl/server";
import { Card, PageHeader } from "@/components/ui";

// Privacy notice (DPDP Act, 2023). Kept bilingual in one page so both versions stay in sync.
const SECTIONS = [
  {
    en: ["What we collect", "Only what you choose to give: notice photos or text you scan, deadlines you save, reports you file (text, photo, location) and your email if you sign in."],
    hi: ["हम क्या लेते हैं", "सिर्फ़ वही जो आप देना चुनें: स्कैन किए नोटिस, सहेजी गई तारीखें, दर्ज शिकायतें (टेक्स्ट, फोटो, जगह) और लॉग इन करने पर आपका ईमेल।"],
  },
  {
    en: ["Why", "To explain notices, remind you before deadlines, route civic problems to the right department and show you their status."],
    hi: ["क्यों", "नोटिस समझाने, अंतिम तिथि से पहले याद दिलाने, शिकायत को सही विभाग तक पहुँचाने और उसकी स्थिति दिखाने के लिए।"],
  },
  {
    en: ["How we protect it", "Aadhaar, phone, PAN and email patterns are masked before any AI model sees your text. Files are kept in private storage. Database rules let you see only your own data; officers see reports from their ward only. Every action on a report is logged."],
    hi: ["सुरक्षा कैसे", "किसी भी AI मॉडल को टेक्स्ट भेजने से पहले आधार, फ़ोन, PAN और ईमेल छिपा दिए जाते हैं। फ़ाइलें निजी स्टोरेज में रहती हैं। आप सिर्फ़ अपना डेटा देख सकते हैं; अधिकारी सिर्फ़ अपने वार्ड की शिकायतें देखते हैं। हर कार्रवाई का रिकॉर्ड रहता है।"],
  },
  {
    en: ["Your rights", "You can see, correct or delete your data and withdraw consent at any time from your account, or by writing to the grievance officer listed on the site."],
    hi: ["आपके अधिकार", "आप कभी भी अपना डेटा देख, सुधार या हटा सकते हैं और सहमति वापस ले सकते हैं।"],
  },
  {
    en: ["AI guidance", "Explanations are guidance, not legal advice. Eligibility for schemes is decided by published rules, not by the AI. Always check the original notice and official source."],
    hi: ["AI मार्गदर्शन", "व्याख्या केवल मार्गदर्शन है, कानूनी सलाह नहीं। योजनाओं की पात्रता प्रकाशित नियमों से तय होती है, AI से नहीं। मूल नोटिस और आधिकारिक स्रोत ज़रूर देखें।"],
  },
];

export default async function PrivacyPage({ params }: { params: Promise<{ locale: string }> }) {
  const { locale } = await params;
  setRequestLocale(locale);
  const lang = locale === "hi" ? "hi" : "en";
  return (
    <>
      <PageHeader title={lang === "hi" ? "गोपनीयता सूचना" : "Privacy notice"} subtitle="Digital Personal Data Protection Act, 2023" />
      <div className="space-y-3">
        {SECTIONS.map((s) => (
          <Card key={s.en[0]}>
            <h2 className="font-semibold">{s[lang][0]}</h2>
            <p className="mt-1 text-muted">{s[lang][1]}</p>
          </Card>
        ))}
      </div>
    </>
  );
}
