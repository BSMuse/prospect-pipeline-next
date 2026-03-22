import axios from 'axios';

// Places API (New) endpoint
const PLACES_NEW_BASE = 'https://places.googleapis.com/v1/places';

export const CATEGORY_GROUPS: Record<string, string[]> = {
  dental: ['dentist', 'dental clinic', 'dental office', 'dental centre', 'dentistry', 'orthodontist', 'oral surgeon', 'periodontist', 'endodontist'],
  physiotherapy: ['physiotherapy', 'physical therapy', 'physio clinic', 'rehabilitation clinic', 'sports physiotherapy'],
  optometry: ['optometrist', 'eye clinic', 'vision care', 'optical', 'eye doctor', 'ophthalmologist'],
  chiropractic: ['chiropractor', 'chiropractic clinic', 'chiropractic', 'spinal care'],
  legal: ['law firm', 'lawyer', 'legal services', 'barrister', 'solicitor', 'attorney', 'notary public', 'immigration lawyer', 'family lawyer'],
  accounting: ['accountant', 'accounting firm', 'CPA', 'bookkeeper', 'tax preparation', 'tax accountant'],
  'real-estate': ['real estate agency', 'realtor', 'real estate broker', 'property management', 'real estate office'],
  veterinary: ['veterinarian', 'vet clinic', 'animal hospital', 'pet clinic', 'veterinary office'],
  massage: ['massage therapy', 'massage therapist', 'RMT', 'registered massage therapy', 'spa massage'],
  'mental-health': ['psychologist', 'counselling', 'therapist', 'mental health clinic', 'psychiatrist', 'counselling services'],
  pharmacy: ['pharmacy', 'drugstore', 'compounding pharmacy', 'apothecary'],
  'financial-planning': ['financial advisor', 'financial planner', 'wealth management', 'investment advisor', 'financial consultant'],
  insurance: ['insurance agency', 'insurance broker', 'insurance agent', 'life insurance', 'home insurance'],
  'home-services': ['plumber', 'plumbing', 'electrician', 'HVAC', 'roofing', 'general contractor', 'home renovation'],
  'auto-repair': ['auto repair', 'mechanic', 'car repair', 'auto body shop', 'tire shop', 'oil change'],
  landscaping: ['landscaping', 'lawn care', 'tree service', 'snow removal', 'landscape design'],
  cleaning: ['cleaning service', 'janitorial', 'commercial cleaning', 'house cleaning', 'carpet cleaning'],
  'digital-marketing': ['marketing agency', 'digital marketing', 'SEO agency', 'web design agency', 'advertising agency'],
};

export interface DiscoveredBusiness {
  place_id: string;
  name: string;
  address: string;
  phone?: string;
  website?: string;
  rating?: number;
}

// Edmonton multi-sweep: 5 quadrants to ensure full city coverage
const EDMONTON_SWEEPS = [
  { lat: 53.5461, lng: -113.4938, radius: 8000 },
  { lat: 53.5800, lng: -113.5200, radius: 6000 },
  { lat: 53.5800, lng: -113.4200, radius: 6000 },
  { lat: 53.5100, lng: -113.5200, radius: 6000 },
  { lat: 53.5100, lng: -113.4200, radius: 6000 },
];

// Only request the fields we actually use — keeps cost down
const FIELD_MASK = [
  'places.id',
  'places.displayName',
  'places.formattedAddress',
  'places.nationalPhoneNumber',
  'places.websiteUri',
  'places.rating',
].join(',');

const sleep = (ms: number) => new Promise(r => setTimeout(r, ms));

async function fetchPlacesPage(
  keyword: string,
  lat: number,
  lng: number,
  radius: number,
  pageToken?: string
): Promise<{ results: any[]; nextPageToken?: string }> {
  const body: Record<string, any> = {
    textQuery: keyword,
    locationBias: {
      circle: {
        center: { latitude: lat, longitude: lng },
        radius: radius,
      },
    },
    maxResultCount: 20,
  };

  if (pageToken) {
    body.pageToken = pageToken;
    await sleep(1000); // New API doesn't need the 2s delay the old one did
  }

  const res = await axios.post(
    `${PLACES_NEW_BASE}:searchText`,
    body,
    {
      headers: {
        'X-Goog-Api-Key': process.env.GOOGLE_PLACES_API_KEY!,
        'X-Goog-FieldMask': FIELD_MASK,
        'Content-Type': 'application/json',
      },
    }
  );

  return {
    results: res.data.places || [],
    nextPageToken: res.data.nextPageToken,
  };
}

export async function discoverBusinesses(
  category: string,
  onProgress?: (msg: string) => void
): Promise<DiscoveredBusiness[]> {
  const keywords = CATEGORY_GROUPS[category.toLowerCase()] || [category];
  const seen = new Set<string>();
  const businesses: DiscoveredBusiness[] = [];
  const delay = parseInt(process.env.PIPELINE_DELAY_MS || '500');

  for (const [ki, keyword] of keywords.entries()) {
    onProgress?.(`Keyword ${ki + 1}/${keywords.length}: "${keyword}"`);

    for (const [i, sweep] of EDMONTON_SWEEPS.entries()) {
      onProgress?.(`  Zone ${i + 1}/${EDMONTON_SWEEPS.length} for "${keyword}"...`);
      let pageToken: string | undefined;

      do {
        try {
          const { results, nextPageToken } = await fetchPlacesPage(
            keyword, sweep.lat, sweep.lng, sweep.radius, pageToken
          );

          for (const place of results) {
            const placeId: string = place.id;
            if (seen.has(placeId)) continue;
            seen.add(placeId);

            await sleep(delay);

            businesses.push({
              place_id: placeId,
              name: place.displayName?.text || '',
              address: place.formattedAddress || '',
              phone: place.nationalPhoneNumber,
              website: place.websiteUri,
              rating: place.rating,
            });
          }

          pageToken = nextPageToken;
        } catch (err: any) {
          const detail = err.response?.data ? JSON.stringify(err.response.data) : err.message;
          onProgress?.(`  Zone ${i + 1} error: ${detail}`);
          pageToken = undefined;
        }
      } while (pageToken);
    }
  }

  onProgress?.(`Discovery complete: ${businesses.length} businesses found`);
  return businesses;
}
