export type Site = {
  id: string;
  name: string;
  county: string;
  state: string;
  latitude: number;
  longitude: number;
};

export type DisruptionEvent = {
  source: "weather.gov" | "openfema";
  id: string;
  type: string;
  severity: string;
  headline: string;
  startsAt?: string;
  endsAt?: string;
  payload: Record<string, unknown>;
};

export async function fetchDisruptions(site: Site) {
  const agent = "ReliefLink-ATLAS/1.0 (food-bank-coordination)";
  const weatherUrl = `https://api.weather.gov/alerts/active?point=${site.latitude},${site.longitude}`;
  const cutoff = new Date(Date.now() - 60 * 86400000).toISOString();
  const femaUrl = `https://www.fema.gov/api/open/v2/DisasterDeclarationsSummaries?$filter=state%20eq%20'${site.state}'%20and%20declarationDate%20ge%20'${cutoff}'&$top=100&$orderby=declarationDate%20desc`;
  const [weatherResult, femaResult] = await Promise.allSettled([
    fetch(weatherUrl, {
      headers: { "User-Agent": agent, Accept: "application/geo+json" },
      cache: "no-store",
      signal: AbortSignal.timeout(8000),
    }).then((response) => {
      if (!response.ok) throw new Error(`NWS ${response.status}`);
      return response.json();
    }),
    fetch(femaUrl, {
      headers: { "User-Agent": agent },
      cache: "no-store",
      signal: AbortSignal.timeout(8000),
    }).then((response) => {
      if (!response.ok) throw new Error(`FEMA ${response.status}`);
      return response.json();
    }),
  ]);
  const weather: DisruptionEvent[] =
    weatherResult.status === "fulfilled"
      ? (weatherResult.value.features || []).map((event: any) => ({
          source: "weather.gov",
          id: String(event.id),
          type: String(event.properties?.event || "Weather alert"),
          severity: String(event.properties?.severity || "Unknown"),
          headline: String(
            event.properties?.headline || event.properties?.event,
          ),
          startsAt: event.properties?.onset || event.properties?.effective,
          endsAt: event.properties?.ends || event.properties?.expires,
          payload: event.properties,
        }))
      : [];
  const county = site.county.toLowerCase().replace(/ county$/, "");
  const fema: DisruptionEvent[] =
    femaResult.status === "fulfilled"
      ? (femaResult.value.DisasterDeclarationsSummaries || [])
          .filter((event: any) =>
            String(event.designatedArea || "")
              .toLowerCase()
              .includes(county),
          )
          .map((event: any) => ({
            source: "openfema",
            id: String(
              event.id || `${event.disasterNumber}-${event.designatedArea}`,
            ),
            type: String(event.incidentType || "Disaster declaration"),
            severity: "Severe",
            headline: `${event.declarationTitle || event.incidentType} · ${event.designatedArea}`,
            startsAt: event.incidentBeginDate,
            endsAt: event.incidentEndDate,
            payload: event,
          }))
      : [];
  return {
    events: [...weather, ...fema],
    sources: {
      weather: weatherResult.status,
      fema: femaResult.status,
    },
  };
}

export function severityMultiplier(
  events: Array<{ source: string; severity: string }>,
) {
  let multiplier = 1;
  for (const event of events)
    multiplier = Math.max(
      multiplier,
      event.source === "openfema"
        ? 1.5
        : event.severity === "Extreme"
          ? 1.75
          : event.severity === "Severe"
            ? 1.5
            : event.severity === "Moderate"
              ? 1.25
              : 1.1,
    );
  return multiplier;
}

export function forecastDemand(history: number[], multiplier: number) {
  if (!history.length)
    return {
      baseline: 0,
      trend: 0,
      forecast: 0,
      confidence: 0.35,
      method: "network-balance baseline; no dispatch history",
    };
  const count = history.length;
  const average = history.reduce((sum, value) => sum + value, 0) / count;
  const xMean = (count - 1) / 2;
  const denominator = history.reduce(
    (sum, _, index) => sum + (index - xMean) ** 2,
    0,
  );
  const slope =
    count > 1 && denominator
      ? history.reduce(
          (sum, value, index) => sum + (index - xMean) * (value - average),
          0,
        ) / denominator
      : 0;
  const next = average - slope * xMean + slope * count;
  return {
    baseline: Number(average.toFixed(2)),
    trend: Number(slope.toFixed(2)),
    forecast: Math.ceil(Math.max(0, next) * multiplier),
    confidence: Math.min(0.92, 0.45 + count / 45),
    method: "least-squares trend + live disruption multiplier",
  };
}

export function networkBalanceTarget(
  localOnHand: number,
  peerOnHand: number[],
) {
  if (!peerOnHand.length) return 0;
  return Math.floor(
    (localOnHand + peerOnHand.reduce((sum, value) => sum + value, 0)) /
      (peerOnHand.length + 1),
  );
}

export function haversine(a: Site, b: Site) {
  const radius = 3958.8;
  const radians = (value: number) => (value * Math.PI) / 180;
  const latitude = radians(b.latitude - a.latitude);
  const longitude = radians(b.longitude - a.longitude);
  const value =
    Math.sin(latitude / 2) ** 2 +
    Math.cos(radians(a.latitude)) *
      Math.cos(radians(b.latitude)) *
      Math.sin(longitude / 2) ** 2;
  return 2 * radius * Math.asin(Math.sqrt(value));
}

export async function fetchOptimalRoute(from: Site, to: Site) {
  const fallbackDistance = haversine(from, to);
  const fallback = {
    source: "straight-line fallback" as const,
    distanceMiles: Number(fallbackDistance.toFixed(1)),
    estimatedMinutes: Math.max(10, Math.ceil((fallbackDistance / 35) * 60)),
    coordinates: [
      [from.latitude, from.longitude],
      [to.latitude, to.longitude],
    ] as [number, number][],
  };
  try {
    const url = `https://router.project-osrm.org/route/v1/driving/${from.longitude},${from.latitude};${to.longitude},${to.latitude}?overview=full&geometries=geojson&steps=false`;
    const response = await fetch(url, {
      cache: "no-store",
      signal: AbortSignal.timeout(8000),
      headers: { "User-Agent": "ReliefLink-ATLAS/1.0" },
    });
    if (!response.ok) return fallback;
    const body = await response.json();
    const route = body.routes?.[0];
    if (!route?.geometry?.coordinates?.length) return fallback;
    return {
      source: "OSRM road route" as const,
      distanceMiles: Number((Number(route.distance) / 1609.344).toFixed(1)),
      estimatedMinutes: Math.max(1, Math.ceil(Number(route.duration) / 60)),
      coordinates: route.geometry.coordinates.map(
        ([longitude, latitude]: [number, number]) =>
          [latitude, longitude] as [number, number],
      ),
    };
  } catch {
    return fallback;
  }
}
