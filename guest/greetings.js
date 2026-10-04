// "Hello" in the language of the place where the guest is: Buenos días in Peru, Namaste in Nepal, Good morning in the United States.
// Matched on the destination's country (as typed in the trip). A place with one all-day greeting uses `any`. Anything unknown falls back to English.
// The time of day is the hour THERE (the destination's own time zone), so the greeting is right wherever the phone is.

const LANGS = {
  english: { language: 'English', morning: 'Good morning', afternoon: 'Good afternoon', evening: 'Good evening' },
  spanish: { language: 'Spanish', morning: 'Buenos días', afternoon: 'Buenas tardes', evening: 'Buenas noches' },
  portuguese: { language: 'Portuguese', morning: 'Bom dia', afternoon: 'Boa tarde', evening: 'Boa noite' },
  turkish: { language: 'Turkish', morning: 'Günaydın', afternoon: 'İyi günler', evening: 'İyi akşamlar' },
  japanese: { language: 'Japanese', morning: 'Ohayō gozaimasu', afternoon: 'Konnichiwa', evening: 'Konbanwa' },
  arabic: { language: 'Arabic', morning: 'Sabah al-khair', afternoon: 'Marhaba', evening: 'Masa al-khair' },
  french: { language: 'French', morning: 'Bonjour', afternoon: 'Bonjour', evening: 'Bonsoir' },
  samoan: { language: 'Samoan', any: 'Talofa' },
  khmer: { language: 'Khmer', any: 'Suosdey' },
  nepali: { language: 'Nepali', any: 'Namaste' },
  dzongkha: { language: 'Dzongkha', any: 'Kuzuzangpo la' },
  hindi: { language: 'Hindi', any: 'Namaste' },
  swahili: { language: 'Swahili', any: 'Jambo' },
  kinyarwanda: { language: 'Kinyarwanda', any: 'Muraho' },
  zulu: { language: 'Zulu', any: 'Sawubona' },
  creole: { language: 'Seychellois Creole', any: 'Bonzour' },
  dhivehi: { language: 'Dhivehi', any: 'Assalaamu alaikum' },
  aussie: { language: 'Australian English', any: "G'day" },
};
const BY_COUNTRY = {
  usa: 'english', 'united states': 'english', uk: 'english', 'united kingdom': 'english', peru: 'spanish', chile: 'spanish', spain: 'spanish', mexico: 'spanish', argentina: 'spanish',
  portugal: 'portuguese', brazil: 'portuguese', turkey: 'turkish', türkiye: 'turkish', japan: 'japanese', jordan: 'arabic', morocco: 'arabic', egypt: 'arabic',
  france: 'french', samoa: 'samoan', cambodia: 'khmer', nepal: 'nepali', bhutan: 'dzongkha', india: 'hindi', tanzania: 'swahili', kenya: 'swahili', rwanda: 'kinyarwanda',
  'south africa': 'zulu', seychelles: 'creole', maldives: 'dhivehi', australia: 'aussie',
};

// hour: 0 to 23 where the guest is. Returns { text, language, english } e.g. { text: 'Buenos días', language: 'Spanish', english: 'Good morning' }.
export function greetingFor(country, hour) {
  const entry = LANGS[BY_COUNTRY[String(country ?? '').trim().toLowerCase()] ?? 'english'];
  const part = hour < 12 ? 'morning' : hour < 18 ? 'afternoon' : 'evening';
  return { text: entry.any ?? entry[part], language: entry.language, english: entry.any ? 'Hello' : LANGS.english[part] };
}
