export function buildDetailParams({ airport, from, to, airlines, rules }) {
  const params = new URLSearchParams({ airport });
  if (from) params.set('from', from);
  if (to) params.set('to', to);
  [...airlines].sort().forEach((code) => params.append('airline', code));
  rules.forEach(({ column, operator, value }) => params.append('metric', `${column}:${operator}:${value}`));
  return params;
}

export function airlineChoiceParams(detailParams) {
  const params = new URLSearchParams(detailParams);
  params.delete('airline');
  params.delete('metric');
  return params;
}

export function unavailableAirlineCodes(selected, available) {
  const codes = new Set(available.map((item) => item.code));
  return [...selected].filter((code) => !codes.has(code));
}