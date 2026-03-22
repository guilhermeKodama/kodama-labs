const PREPOSITIONS = new Set([
  "DE", "DA", "DO", "DOS", "DAS", "E", "DI", "DEL", "DELLA",
]);

// IBGE census-based surname frequency tiers.
// Rarity: 0 = extremely common (everyone has it), 1 = very rare.
const TIER_1_RARITY = 0.05; // top 10
const TIER_2_RARITY = 0.15; // top 30
const TIER_3_RARITY = 0.30; // top 80
const TIER_4_RARITY = 0.50; // top 200
const UNKNOWN_RARITY = 0.85;

const SURNAME_TIERS: [number, string[]][] = [
  [TIER_1_RARITY, [
    "SILVA", "SANTOS", "OLIVEIRA", "SOUZA", "SOUSA", "RODRIGUES",
    "FERREIRA", "ALVES", "PEREIRA", "LIMA",
  ]],
  [TIER_2_RARITY, [
    "GOMES", "COSTA", "RIBEIRO", "MARTINS", "CARVALHO", "ALMEIDA",
    "LOPES", "SOARES", "FERNANDES", "VIEIRA", "BARBOSA", "ROCHA",
    "ARAUJO", "NASCIMENTO", "ANDRADE", "MOREIRA", "NUNES", "MARQUES",
    "MACHADO", "MENDES",
  ]],
  [TIER_3_RARITY, [
    "FREITAS", "CARDOSO", "RAMOS", "GONCALVES", "SANTANA", "TEIXEIRA",
    "DIAS", "MORAES", "MORAIS", "MEDEIROS", "BATISTA", "CAMPOS",
    "HENRIQUE", "HENRIQUES", "CORREIA", "CORREA", "REIS", "BARROS",
    "CRUZ", "DUARTE", "CUNHA", "AZEVEDO", "PINTO", "AMARAL",
    "CASTRO", "MONTEIRO", "BORGES", "MELO", "SIQUEIRA", "PINHEIRO",
    "AMORIM", "LEITE", "BEZERRA", "SAMPAIO", "FONSECA", "AGUIAR",
    "BRITO", "COUTINHO", "COELHO", "PEIXOTO", "FARIAS", "MOTA",
    "REZENDE", "NOGUEIRA", "XAVIER", "ASSIS", "VIANA", "CAMARGO",
    "GUIMARAES", "LACERDA",
  ]],
  [TIER_4_RARITY, [
    "MIRANDA", "CAVALCANTI", "CAVALCANTE", "BARRETO", "BARROSO",
    "PIRES", "SALES", "QUEIROZ", "QUEIROGA", "BUENO", "CABRAL",
    "FIGUEIREDO", "LEAL", "TAVARES", "MAIA", "MOURA", "PACHECO",
    "SENA", "MAGALHAES", "CHAVES", "BASTOS", "ABREU", "BRAGA",
    "RANGEL", "BRAZ", "TOLEDO", "DANTAS", "CARNEIRO", "VARGAS",
    "FLORES", "ARRUDA", "MESQUITA", "TRINDADE", "PORTO", "PADILHA",
    "VASCONCELOS", "MATOS", "MATTOS", "LAGO", "ESTEVES", "LIRA",
    "BRANDAO", "CALHEIROS", "CORDEIRO", "COUTO", "DINIZ", "DOMINGUES",
    "DOURADO", "DRUMOND", "DRUMMOND", "FARIA", "GASPAR", "GIRALDI",
    "GODOY", "GODOI", "GOUVEIA", "GOUVEA", "GUERREIRO", "GUEDES",
    "INACIO", "JORGE", "MACEDO", "MACIEL", "MALDONADO", "MARINHO",
    "MEIRA", "MELLO", "NERY", "NETO", "NEVES", "PAIVA", "PASSOS",
    "PENHA", "PRADO", "PROENCA", "RABELO", "RAMALHO", "RAPOSO",
    "RENATO", "RESENDE", "SÁ", "SALGADO", "SERGIO", "SERPA",
    "SILVEIRA", "SIMOES", "TAVEIRA", "VALENTE", "VALE", "VIANNA",
    "VILELA", "VILLELA", "VITAL",
  ]],
];

const SURNAME_RARITY_MAP = new Map<string, number>();
for (const [rarity, names] of SURNAME_TIERS) {
  for (const name of names) {
    SURNAME_RARITY_MAP.set(name, rarity);
  }
}

export function getSurnameRarity(surname: string): number {
  const normalized = normalizeName(surname);
  return SURNAME_RARITY_MAP.get(normalized) ?? UNKNOWN_RARITY;
}

export interface SurnameMatchResult {
  score: number;
  matchedSurnames: string[];
  rarestSurname: string;
  rarestScore: number;
  isLastSurnameMatch: boolean;
}

export function computeSurnameMatchScore(
  nameA: string,
  nameB: string,
): SurnameMatchResult | null {
  const surnamesA = new Set(extractSurnames(nameA));
  const surnamesB = extractSurnames(nameB);
  const matched = surnamesB.filter((s) => surnamesA.has(s));

  if (matched.length === 0) return null;

  const lastA = extractLastSurname(nameA);
  const lastB = extractLastSurname(nameB);
  const isLastSurnameMatch = !!(lastA && lastB && lastA === lastB);

  let rarestScore = 0;
  let rarestSurname = matched[0]!;
  for (const s of matched) {
    const r = getSurnameRarity(s);
    if (r > rarestScore) {
      rarestScore = r;
      rarestSurname = s;
    }
  }

  let score = rarestScore;
  if (matched.length >= 2) score *= 1.5;
  if (isLastSurnameMatch) score *= 1.3;
  score = Math.min(1.0, score);

  return { score, matchedSurnames: matched, rarestSurname, rarestScore, isLastSurnameMatch };
}

export function normalizeName(name: string): string {
  return name
    .toUpperCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .trim();
}

export function extractSurnames(fullName: string): string[] {
  const tokens = normalizeName(fullName).split(/\s+/);
  if (tokens.length < 2) return [];

  return tokens.slice(1).filter((t) => !PREPOSITIONS.has(t) && t.length > 1);
}

export function extractLastSurname(fullName: string): string | null {
  const surnames = extractSurnames(fullName);
  return surnames.length > 0 ? surnames[surnames.length - 1]! : null;
}

export function hasSurnameOverlap(nameA: string, nameB: string): boolean {
  const surnamesA = new Set(extractSurnames(nameA));
  const surnamesB = extractSurnames(nameB);
  return surnamesB.some((s) => surnamesA.has(s));
}

export function getOverlappingSurnames(nameA: string, nameB: string): string[] {
  const surnamesA = new Set(extractSurnames(nameA));
  return extractSurnames(nameB).filter((s) => surnamesA.has(s));
}
