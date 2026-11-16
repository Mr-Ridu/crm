// Bangladesh's 64 districts, grouped into the 8 divisions.
// The grid is used per niche campaign: each district is allocated to exactly one
// team member inside a campaign, so the canonical English name doubles as the
// storage key for an allocation.
export interface Division {
  name: string;
  districts: string[];
}

export const BD_DIVISIONS: Division[] = [
  {
    name: 'Dhaka',
    districts: [
      'Dhaka', 'Gazipur', 'Narayanganj', 'Tangail', 'Kishoreganj', 'Manikganj',
      'Munshiganj', 'Narsingdi', 'Faridpur', 'Madaripur', 'Gopalganj', 'Rajbari',
      'Shariatpur',
    ],
  },
  {
    name: 'Chattogram',
    districts: [
      'Chattogram', "Cox's Bazar", 'Rangamati', 'Bandarban', 'Khagrachhari',
      'Feni', 'Lakshmipur', 'Noakhali', 'Cumilla', 'Brahmanbaria', 'Chandpur',
    ],
  },
  {
    name: 'Rajshahi',
    districts: [
      'Rajshahi', 'Bogura', 'Pabna', 'Sirajganj', 'Naogaon', 'Natore',
      'Chapainawabganj', 'Joypurhat',
    ],
  },
  {
    name: 'Khulna',
    districts: [
      'Khulna', 'Jashore', 'Satkhira', 'Meherpur', 'Narail', 'Chuadanga',
      'Kushtia', 'Magura', 'Bagerhat', 'Jhenaidah',
    ],
  },
  {
    name: 'Barishal',
    districts: ['Barishal', 'Bhola', 'Jhalokati', 'Patuakhali', 'Pirojpur', 'Barguna'],
  },
  {
    name: 'Sylhet',
    districts: ['Sylhet', 'Moulvibazar', 'Habiganj', 'Sunamganj'],
  },
  {
    name: 'Rangpur',
    districts: [
      'Rangpur', 'Dinajpur', 'Gaibandha', 'Kurigram', 'Lalmonirhat', 'Nilphamari',
      'Panchagarh', 'Thakurgaon',
    ],
  },
  {
    name: 'Mymensingh',
    districts: ['Mymensingh', 'Jamalpur', 'Sherpur', 'Netrokona'],
  },
];

export const BD_DISTRICTS: string[] = BD_DIVISIONS.flatMap((d) => d.districts);

export const BD_DISTRICT_TOTAL = BD_DISTRICTS.length; // 64

/** Lowercase, drop punctuation — Bangla letters survive so both spellings match. */
export function normalizeDistrictText(value: string): string {
  return String(value || '')
    .toLowerCase()
    .replace(/[’‘`]/g, "'")
    .replace(/[^a-z0-9\u0980-\u09FF]/g, '');
}

// Alternate spellings and the Bangla name of every district. Scraped addresses
// use both, and the lot names are typed by hand, so matching has to be lenient.
const DISTRICT_ALIASES: Record<string, string[]> = {
  Dhaka: ['Dacca', 'ঢাকা'],
  Gazipur: ['Gazipura', 'গাজীপুর'],
  Narayanganj: ['Narayangonj', 'নারায়ণগঞ্জ', 'নারায়ণগঞ্জ'],
  Tangail: ['Tangail', 'টাঙ্গাইল'],
  Kishoreganj: ['Kishoregonj', 'কিশোরগঞ্জ'],
  Manikganj: ['Manikgonj', 'মানিকগঞ্জ'],
  Munshiganj: ['Munshigonj', 'মুন্সিগঞ্জ'],
  Narsingdi: ['Narshingdi', 'নরসিংদী'],
  Faridpur: ['Faridpore', 'ফরিদপুর'],
  Madaripur: ['Madaripore', 'মাদারীপুর'],
  Gopalganj: ['Gopalgonj', 'গোপালগঞ্জ'],
  Rajbari: ['Rajbaree', 'রাজবাড়ী', 'রাজবাড়ী'],
  Shariatpur: ['Shariatpore', 'শরীয়তপুর', 'শরীয়তপুর'],
  Chattogram: ['Chittagong', 'Chattagram', 'Chittagong', 'চট্টগ্রাম'],
  "Cox's Bazar": ['Coxs Bazar', 'Cox Bazar', 'Koks Bazar', 'কক্সবাজার'],
  Rangamati: ['Rangamattee', 'রাঙ্গামাটি', 'রাঙামাটি'],
  Bandarban: ['Bandarbon', 'বান্দরবান'],
  Khagrachhari: ['Khagrachari', 'Khagracheri', 'খাগড়াছড়ি', 'খাগড়াছড়ি'],
  Feni: ['Fenny', 'ফেনী'],
  Lakshmipur: ['Laxmipur', 'Lakshmipore', 'লক্ষ্মীপুর'],
  Noakhali: ['Noakhaly', 'নোয়াখালী', 'নোয়াখালী'],
  Cumilla: ['Comilla', 'কুমিল্লা'],
  Brahmanbaria: ['Brahmanbariya', 'ব্রাহ্মণবাড়িয়া', 'ব্রাহ্মণবাড়িয়া'],
  Chandpur: ['Chandpore', 'চাঁদপুর'],
  Rajshahi: ['Rajshahye', 'রাজশাহী'],
  Bogura: ['Bogra', 'বগুড়া', 'বগুড়া'],
  Pabna: ['Pabna', 'পাবনা'],
  Sirajganj: ['Sirajgonj', 'সিরাজগঞ্জ'],
  Naogaon: ['Nawgaon', 'Nogaon', 'নওগাঁ'],
  Natore: ['Natore', 'নাটোর'],
  Chapainawabganj: ['Chapai Nawabganj', 'Chapainababganj', 'চাঁপাইনবাবগঞ্জ'],
  Joypurhat: ['Jaipurhat', 'Joypurhat', 'জয়পুরহাট', 'জয়পুরহাট'],
  Khulna: ['Khulna', 'খুলনা'],
  Jashore: ['Jessore', 'যশোর'],
  Satkhira: ['Satkhira', 'সাতক্ষীরা'],
  Meherpur: ['Meherpore', 'মেহেরপুর'],
  Narail: ['Naraile', 'নড়াইল', 'নড়াইল'],
  Chuadanga: ['Chuadanga', 'চুয়াডাঙ্গা', 'চুয়াডাঙ্গা'],
  Kushtia: ['Kustia', 'কুষ্টিয়া', 'কুষ্টিয়া'],
  Magura: ['Magura', 'মাগুরা'],
  Bagerhat: ['Bagerhaat', 'বাগেরহাট'],
  Jhenaidah: ['Jhenidah', 'Jhinaidah', 'ঝিনাইদহ'],
  Barishal: ['Barisal', 'বরিশাল'],
  Bhola: ['Bhola', 'ভোলা'],
  Jhalokati: ['Jhalokathi', 'ঝালকাঠি'],
  Patuakhali: ['Potuakhali', 'পটুয়াখালী', 'পটুয়াখালী'],
  Pirojpur: ['Pirojpore', 'পিরোজপুর'],
  Barguna: ['Barguna', 'বরগুনা'],
  Sylhet: ['Silet', 'সিলেট'],
  Moulvibazar: ['Maulvibazar', 'Moulavibazar', 'মৌলভীবাজার'],
  Habiganj: ['Hobiganj', 'হবিগঞ্জ'],
  Sunamganj: ['Sunamgonj', 'সুনামগঞ্জ'],
  Rangpur: ['Rongpur', 'রংপুর'],
  Dinajpur: ['Dinajpore', 'দিনাজপুর'],
  Gaibandha: ['Gaibanda', 'গাইবান্ধা'],
  Kurigram: ['Kurigram', 'কুড়িগ্রাম', 'কুড়িগ্রাম'],
  Lalmonirhat: ['Lalmonirhaat', 'লালমনিরহাট'],
  Nilphamari: ['Nilfamari', 'নীলফামারী'],
  Panchagarh: ['Panchagar', 'পঞ্চগড়', 'পঞ্চগড়'],
  Thakurgaon: ['Thakurgaon', 'ঠাকুরগাঁও'],
  Mymensingh: ['Momenshahi', 'Mymensing', 'ময়মনসিংহ', 'ময়মনসিংহ'],
  Jamalpur: ['Jamalpore', 'জামালপুর'],
  Sherpur: ['Sherpore', 'শেরপুর'],
  Netrokona: ['Netrakona', 'নেত্রকোনা'],
};

// Longest alias first: "Cox's Bazar" must win before a shorter partial match.
const LOOKUP: { needle: string; district: string }[] = (() => {
  const pairs: { needle: string; district: string }[] = [];
  for (const district of BD_DISTRICTS) {
    const names = [district, ...(DISTRICT_ALIASES[district] || [])];
    for (const name of names) {
      const needle = normalizeDistrictText(name);
      if (needle.length >= 4) pairs.push({ needle, district });
    }
  }
  return pairs.sort((a, b) => b.needle.length - a.needle.length);
})();

/**
 * First district mentioned in any of the given texts, or null.
 * Called with the lot name first (that is how the team files their sheets:
 * "Lot — Diagnostic Jamalpur"), then the lead address as a fallback.
 */
export function detectDistrict(...texts: (string | undefined | null)[]): string | null {
  for (const text of texts) {
    const haystack = normalizeDistrictText(text || '');
    if (!haystack) continue;
    for (const { needle, district } of LOOKUP) {
      if (haystack.includes(needle)) return district;
    }
  }
  return null;
}

const CAMPAIGN_STOPWORDS = new Set([
  'shop', 'shops', 'store', 'stores', 'center', 'centre', 'centers', 'centres',
  'business', 'businesses', 'company', 'co', 'ltd', 'the', 'and',
]);

/**
 * Campaign key for a "niche" value. The same campaign is spelled differently in
 * uploaded sheets ("Diagnostic Center" / "Diagnostic Centre" / "cosmetics shop"),
 * so those variants have to collapse into one key.
 */
export function campaignKey(niche: string): string {
  const words = String(niche || '')
    .toLowerCase()
    .replace(/[^a-z0-9\u0980-\u09FF]+/g, ' ')
    .trim()
    .split(' ')
    .filter(Boolean)
    .filter((w) => !CAMPAIGN_STOPWORDS.has(w))
    .map((w) => (w === 'diagnostics' || w === 'diagnosis' ? 'diagnostic' : w));
  const joined = words.join('');
  // "ornaments" -> "ornament", "cosmetics" -> "cosmetic"
  return joined.length > 4 ? joined.replace(/s$/, '') : joined;
}

export function campaignLabel(key: string): string {
  if (!key) return 'No niche';
  return key.charAt(0).toUpperCase() + key.slice(1);
}
