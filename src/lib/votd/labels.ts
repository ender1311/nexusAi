// src/lib/votd/labels.ts
export type GuidedLabels = { guidedScripture: string; guidedPrayer: string };

/** "Today's Guided Scripture" / "Today's Guided Prayer" per content language.
 *  Keyed by primary subtags plus the regional keys that exist in VERSION_MAP
 *  (zh_CN, zh_TW, sr_CYRILLIC, ku_IQ). en_GB resolves via primary "en". */
const LABELS: Record<string, GuidedLabels> = {
  af: { guidedScripture: "Vandag se Begeleide Skriflesing", guidedPrayer: "Vandag se Begeleide Gebed" },
  am: { guidedScripture: "የዛሬ የተመራ ቅዱስ ጽሑፍ", guidedPrayer: "የዛሬ የተመራ ጸሎት" },
  ar: { guidedScripture: "آيات اليوم الموجّهة", guidedPrayer: "صلاة اليوم الموجّهة" },
  be: { guidedScripture: "Сённяшняе кіраванае чытанне Пісання", guidedPrayer: "Сённяшняя кіраваная малітва" },
  ca: { guidedScripture: "L'Escriptura guiada d'avui", guidedPrayer: "La pregària guiada d'avui" },
  cy: { guidedScripture: "Ysgrythur dywysedig heddiw", guidedPrayer: "Gweddi dywysedig heddiw" },
  da: { guidedScripture: "Dagens guidede skriftlæsning", guidedPrayer: "Dagens guidede bøn" },
  de: { guidedScripture: "Heutige geführte Schriftlesung", guidedPrayer: "Heutiges geführtes Gebet" },
  el: { guidedScripture: "Η σημερινή καθοδηγούμενη Γραφή", guidedPrayer: "Η σημερινή καθοδηγούμενη προσευχή" },
  en: { guidedScripture: "Today's Guided Scripture", guidedPrayer: "Today's Guided Prayer" },
  es: { guidedScripture: "La Escritura guiada de hoy", guidedPrayer: "La oración guiada de hoy" },
  et: { guidedScripture: "Tänane juhitud pühakiri", guidedPrayer: "Tänane juhitud palve" },
  fa: { guidedScripture: "کتاب‌مقدس هدایت‌شده امروز", guidedPrayer: "دعای هدایت‌شده امروز" },
  fr: { guidedScripture: "Lecture guidée du jour", guidedPrayer: "Prière guidée du jour" },
  gu: { guidedScripture: "આજનું માર્ગદર્શિત શાસ્ત્ર", guidedPrayer: "આજની માર્ગદર્શિત પ્રાર્થના" },
  he: { guidedScripture: "כתבי הקודש המודרכים של היום", guidedPrayer: "התפילה המודרכת של היום" },
  hi: { guidedScripture: "आज का मार्गदर्शित पवित्रशास्त्र", guidedPrayer: "आज की मार्गदर्शित प्रार्थना" },
  hr: { guidedScripture: "Današnje vođeno Pismo", guidedPrayer: "Današnja vođena molitva" },
  ht: { guidedScripture: "Ekriti gide jodi a", guidedPrayer: "Lapriyè gide jodi a" },
  hu: { guidedScripture: "A mai vezetett igeolvasás", guidedPrayer: "A mai vezetett imádság" },
  hy: { guidedScripture: "Այսօրվա առաջնորդվող Սուրբ Գիրքը", guidedPrayer: "Այսօրվա առաջնորդվող աղոթքը" },
  id: { guidedScripture: "Firman Terpandu Hari Ini", guidedPrayer: "Doa Terpandu Hari Ini" },
  ig: { guidedScripture: "Akwụkwọ Nsọ nduzi nke taa", guidedPrayer: "Ekpere nduzi nke taa" },
  is: { guidedScripture: "Leiðsögð ritning dagsins", guidedPrayer: "Leiðsögð bæn dagsins" },
  it: { guidedScripture: "La Scrittura guidata di oggi", guidedPrayer: "La preghiera guidata di oggi" },
  ja: { guidedScripture: "今日のガイド付き聖書", guidedPrayer: "今日のガイド付き祈り" },
  ka: { guidedScripture: "დღევანდელი მართული წმინდა წერილი", guidedPrayer: "დღევანდელი მართული ლოცვა" },
  km: { guidedScripture: "បទគម្ពីរណែនាំថ្ងៃនេះ", guidedPrayer: "ការអធិស្ឋានណែនាំថ្ងៃនេះ" },
  kn: { guidedScripture: "ಇಂದಿನ ಮಾರ್ಗದರ್ಶಿ ಧರ್ಮಶಾಸ್ತ್ರ", guidedPrayer: "ಇಂದಿನ ಮಾರ್ಗದರ್ಶಿ ಪ್ರಾರ್ಥನೆ" },
  ko: { guidedScripture: "오늘의 가이드 성경", guidedPrayer: "오늘의 가이드 기도" },
  ku_IQ: { guidedScripture: "نووسراوی پیرۆزی ڕێنماییکراوی ئەمڕۆ", guidedPrayer: "نوێژی ڕێنماییکراوی ئەمڕۆ" },
  ln: { guidedScripture: "Likomi ya botambwisi ya lelo", guidedPrayer: "Libondeli ya botambwisi ya lelo" },
  lt: { guidedScripture: "Šios dienos vedamas Šventasis Raštas", guidedPrayer: "Šios dienos vedama malda" },
  lv: { guidedScripture: "Šodienas vadītie Raksti", guidedPrayer: "Šodienas vadītā lūgšana" },
  mg: { guidedScripture: "Soratra Masina voatari-dalana androany", guidedPrayer: "Vavaka voatari-dalana androany" },
  mn: { guidedScripture: "Өнөөдрийн удирдамжтай Бичээс", guidedPrayer: "Өнөөдрийн удирдамжтай залбирал" },
  mr: { guidedScripture: "आजचे मार्गदर्शित शास्त्र", guidedPrayer: "आजची मार्गदर्शित प्रार्थना" },
  ms: { guidedScripture: "Kitab Suci Berpandu Hari Ini", guidedPrayer: "Doa Berpandu Hari Ini" },
  my: { guidedScripture: "ယနေ့၏ လမ်းညွှန်ကျမ်းစာ", guidedPrayer: "ယနေ့၏ လမ်းညွှန်ဆုတောင်းချက်" },
  ne: { guidedScripture: "आजको निर्देशित धर्मशास्त्र", guidedPrayer: "आजको निर्देशित प्रार्थना" },
  nl: { guidedScripture: "De begeleide Bijbeltekst van vandaag", guidedPrayer: "Het begeleide gebed van vandaag" },
  no: { guidedScripture: "Dagens veiledede skriftlesning", guidedPrayer: "Dagens veiledede bønn" },
  pa: { guidedScripture: "ਅੱਜ ਦਾ ਮਾਰਗਦਰਸ਼ਿਤ ਪਵਿੱਤਰ ਗ੍ਰੰਥ", guidedPrayer: "ਅੱਜ ਦੀ ਮਾਰਗਦਰਸ਼ਿਤ ਪ੍ਰਾਰਥਨਾ" },
  pl: { guidedScripture: "Dzisiejsze Pismo z przewodnikiem", guidedPrayer: "Dzisiejsza modlitwa z przewodnikiem" },
  pt: { guidedScripture: "A Escritura guiada de hoje", guidedPrayer: "A oração guiada de hoje" },
  ro: { guidedScripture: "Scriptura ghidată de azi", guidedPrayer: "Rugăciunea ghidată de azi" },
  ru: { guidedScripture: "Сегодняшнее Писание с наставлением", guidedPrayer: "Сегодняшняя молитва с наставлением" },
  sl: { guidedScripture: "Današnje vodeno Sveto pismo", guidedPrayer: "Današnja vodena molitev" },
  sn: { guidedScripture: "Rugwaro rwakatungamirirwa rwanhasi", guidedPrayer: "Munyengetero wakatungamirirwa wanhasi" },
  sq: { guidedScripture: "Shkrimi i udhëhequr i sotëm", guidedPrayer: "Lutja e udhëhequr e sotme" },
  sr: { guidedScripture: "Današnje vođeno Pismo", guidedPrayer: "Današnja vođena molitva" },
  sr_CYRILLIC: { guidedScripture: "Данашње вођено Писмо", guidedPrayer: "Данашња вођена молитва" },
  sw: { guidedScripture: "Maandiko ya Kuongozwa ya Leo", guidedPrayer: "Maombi ya Kuongozwa ya Leo" },
  ta: { guidedScripture: "இன்றைய வழிகாட்டப்பட்ட வேதாகமம்", guidedPrayer: "இன்றைய வழிகாட்டப்பட்ட ஜெபம்" },
  te: { guidedScripture: "నేటి మార్గదర్శక లేఖనం", guidedPrayer: "నేటి మార్గదర్శక ప్రార్థన" },
  th: { guidedScripture: "พระคัมภีร์นำทางวันนี้", guidedPrayer: "คำอธิษฐานนำทางวันนี้" },
  tl: { guidedScripture: "Gabay na Kasulatan Ngayon", guidedPrayer: "Gabay na Panalangin Ngayon" },
  tr: { guidedScripture: "Bugünün Rehberli Kutsal Yazısı", guidedPrayer: "Bugünün Rehberli Duası" },
  uk: { guidedScripture: "Сьогоднішнє кероване читання Писання", guidedPrayer: "Сьогоднішня керована молитва" },
  ur: { guidedScripture: "آج کا رہنمائی شدہ کلامِ مقدس", guidedPrayer: "آج کی رہنمائی شدہ دعا" },
  uz: { guidedScripture: "Bugungi yo'naltirilgan Muqaddas Bitik", guidedPrayer: "Bugungi yo'naltirilgan ibodat" },
  ve: { guidedScripture: "Maṅwalo o livhiswaho a ṋamusi", guidedPrayer: "Thabelo yo livhiswaho ya ṋamusi" },
  vi: { guidedScripture: "Kinh Thánh hướng dẫn hôm nay", guidedPrayer: "Lời cầu nguyện hướng dẫn hôm nay" },
  xh: { guidedScripture: "IsiBhalo esikhokelwayo sanamhlanje", guidedPrayer: "Umthandazo okhokelwayo wanamhlanje" },
  yo: { guidedScripture: "Ìwé Mímọ́ atọ́nisọ́nà ti òní", guidedPrayer: "Àdúrà atọ́nisọ́nà ti òní" },
  zh_CN: { guidedScripture: "今日引导式读经", guidedPrayer: "今日引导式祷告" },
  zh_TW: { guidedScripture: "今日引導式讀經", guidedPrayer: "今日引導式禱告" },
  zu: { guidedScripture: "UmBhalo oholwayo wanamuhla", guidedPrayer: "Umthandazo oholwayo wanamuhla" },
};

/** exact tag → primary subtag → English. */
export function guidedLabels(tag: string): GuidedLabels {
  const exact = LABELS[tag];
  if (exact) return exact;
  const primary = LABELS[tag.split("_")[0]];
  if (primary) return primary;
  return LABELS.en;
}
