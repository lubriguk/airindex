// BTS reporting-airline codes present in this dashboard's airport dataset.
export const AIRLINE_NAMES = Object.freeze({
  '9E': 'Endeavor Air',
  AA: 'American Airlines',
  AS: 'Alaska Airlines',
  B6: 'JetBlue Airways',
  DL: 'Delta Air Lines',
  F9: 'Frontier Airlines',
  G4: 'Allegiant Air',
  HA: 'Hawaiian Airlines',
  MQ: 'Envoy Air',
  NK: 'Spirit Airlines',
  OH: 'PSA Airlines',
  OO: 'SkyWest Airlines',
  UA: 'United Airlines',
  WN: 'Southwest Airlines',
  YX: 'Republic Airways',
});

export const airlineName = (code) => AIRLINE_NAMES[code] ?? `Unknown reporting airline`;
export const airlineLabel = (code) => `${airlineName(code)} (${code})`;