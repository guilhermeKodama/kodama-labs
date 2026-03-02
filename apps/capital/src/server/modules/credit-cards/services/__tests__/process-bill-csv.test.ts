import { describe, it, expect } from "vitest";
import {
  parseCsvContent,
  calculateBillTotal,
} from "../process-bill-csv";

// ---------------------------------------------------------------------------
// Real Nubank CSV – bill closing Feb 14, 2026, due Feb 23, 2026
// Expected total (matching Nubank app): R$ 51,274.23
// ---------------------------------------------------------------------------
const NUBANK_CSV = `date,title,amount
2026-02-13,Localizameoo,129.13
2026-02-13,Ifd*Ft Alimentacao,236.94
2026-02-13,D.S.S. Tosto Artigos P,40.00
2026-02-13,"Estorno de ""Mercadolivre*4produtos""",-61.51
2026-02-12,Jim.Com* Grafica Sant,8.80
2026-02-11,Mercado*Bhtrekking,214.90
2026-02-11,Mercadolivre*4produtos,378.06
2026-02-11,Mercadolivre*Mercadol,101.24
2026-02-11,Applecombill,60.00
2026-02-11,Applecombill,99.90
2026-02-10,Ajuste a crédito,-7.79
2026-02-10,Ajuste a crédito,-3.79
2026-02-09,Ajuste a crédito,-39.88
2026-02-09,Cursor Usage Mid Jan,108.44
2026-02-09,Shop Fartura,583.84
2026-02-09,Hotel At Booking.Com,3516.91
2026-02-09,Cursor Usage Mid Jan,222.62
2026-02-09,Ajuste a crédito,-25.06
2026-02-09,"IOF de ""Getyourguide""",39.88
2026-02-09,Nve*Rentcarsltda - Parcela 1/3,654.58
2026-02-09,Ajuste a crédito,-123.09
2026-02-09,Mercado*Janelaecia,45.89
2026-02-09,"IOF de ""Trenitalia - Lefrecce""",25.06
2026-02-09,Ifd*Paulo Fernando Car,186.68
2026-02-09,Getyourguide,1139.58
2026-02-09,"IOF de ""Cursor Usage Mid Jan""",7.79
2026-02-09,App *Lowbankshoes - Parcela 1/6,133.20
2026-02-09,Trenitalia - Lefrecce,716.17
2026-02-09,"IOF de ""Hotel At Booking.Com""",123.09
2026-02-09,"IOF de ""Cursor Usage Mid Jan""",3.79
2026-02-08,Mp *Boulangerie,31.93
2026-02-08,Ajuste a crédito,-8.65
2026-02-08,Getyourguide,1321.17
2026-02-08,Shop Fartura,112.40
2026-02-08,Ajuste a crédito,-162.13
2026-02-08,"IOF de ""Trenitalia - Lefrecce""",8.65
2026-02-08,Ajuste a crédito,-44.26
2026-02-08,Applecombill,12.90
2026-02-08,"IOF de ""Rhb Webshop""",162.13
2026-02-08,"IOF de ""Getyourguide""",46.24
2026-02-08,Trenitalia - Lefrecce,247.41
2026-02-08,"IOF de ""Rhb Webshop""",44.26
2026-02-08,Ig*Companyhero,145.18
2026-02-08,Ajuste a crédito,-46.24
2026-02-08,Rhb Webshop,4632.38
2026-02-08,Restaurante Estancia C,147.78
2026-02-08,Rhb Webshop,1264.67
2026-02-07,"IOF de ""Aeroitalia B2b""",61.81
2026-02-07,Aeroitalia B2b,1766.20
2026-02-07,Ifd*R.C. Cerqueira Ci,80.88
2026-02-07,Atelier 91 Moda Femini,456.00
2026-02-07,Ajuste a crédito,-3.79
2026-02-07,Dm *Rentcarssicily By - Parcela 1/2,171.46
2026-02-07,Ajuste a crédito,-61.81
2026-02-07,Uber Uber *Trip Help.U,8.96
2026-02-07,"IOF de ""Trenitalia - Lefrecce""",33.63
2026-02-07,"IOF de ""Vercel Inc.""",3.79
2026-02-07,Vercel Inc.,108.35
2026-02-07,Uber Uber *Trip Help.U,8.94
2026-02-07,Ajuste a crédito,-33.63
2026-02-07,Trenitalia - Lefrecce,961.08
2026-02-07,Mega Festa Vinhedo,89.98
2026-02-06,Shop Fartura,169.11
2026-02-06,Amazonprimebr,19.90
2026-02-06,Dm*Nintendoeshop,439.90
2026-02-06,Ajuste a crédito,-16.45
2026-02-05,"IOF de ""Cursor Ai Powered Ide""",16.45
2026-02-05,Cursor Ai Powered Ide,470.19
2026-02-04,App *Jovemtec - Parcela 1/3,579.19
2026-02-04,Mercado*Mercadolivre,172.00
2026-02-04,Mercadolivre*Mercadol,1107.73
2026-02-04,Mercadolivre*Mercadoli,1186.90
2026-02-03,Getyourguide,1912.37
2026-02-03,Ajuste a crédito,-66.93
2026-02-03,Notion Labs Inc.,261.25
2026-02-03,Ajuste a crédito,-31.15
2026-02-03,Getyourguide,890.22
2026-02-03,Ajuste a crédito,-47.41
2026-02-03,Getyourguide,1354.70
2026-02-03,Ajuste a crédito,-9.14
2026-02-03,"IOF de ""Getyourguide""",31.15
2026-02-03,"IOF de ""Getyourguide""",66.93
2026-02-03,"IOF de ""Getyourguide""",47.41
2026-02-03,"IOF de ""Notion Labs Inc.""",9.14
2026-02-02,Infangerloja-0002avinh,1077.66
2026-02-02,Ajuste a crédito,-14.76
2026-02-02,Shop Fartura,230.12
2026-02-02,Mercadolivre*Mercadol,68.99
2026-02-02,Mercadolivre*Mercadol,92.89
2026-02-02,Padaria Nobrega,17.94
2026-02-02,Www.Midaticket.It - Du,421.90
2026-02-02,Habitat Come*Rasco - Parcela 1/8,62.28
2026-02-02,"IOF de ""Www.Midaticket.It - Du""",14.76
2026-02-02,Mercadolivre*Mercadol,109.90
2026-02-01,Mp *Boulangerie,18.14
2026-02-01,Mercadolivre*Mbparts,88.90
2026-02-01,Infangerloja-0100avinh,59.50
2026-02-01,Infangerloja-0002avinh,94.50
2026-02-01,"Estorno de ""Amazon Marketplace""",-364.32
2026-02-01,Centro de Abasteciment,247.07
2026-01-31,Ifd*R.C. Cerqueira Ci,80.88
2026-01-31,Angelis,122.80
2026-01-31,Cacau Show,99.97
2026-01-31,Mercadolivre*Doublest,66.93
2026-01-31,Hair Company,227.00
2026-01-31,Ifd*Kazu Sushi Vinhedo,194.85
2026-01-31,EBW*Spotify - NuPay,31.90
2026-01-31,Uber Uber *Trip Help.U,9.96
2026-01-29,Apple.Com/Bill,45.90
2026-01-29,Cobasi Vinhedo,169.90
2026-01-28,Tnf Ecommerce - Parcela 1/6,899.35
2026-01-28,Pg *Dilani Confeccao e - Parcela 1/4,150.62
2026-01-27,Ifd*Kazu Sushi Vinhedo,194.85
2026-01-27,Apple.Com/Bill,47.00
2026-01-27,Mercadolivre*Aventura,1277.36
2026-01-27,Borracharia do Japao,20.00
2026-01-27,Tnf Ecommerce - Parcela 1/6,498.95
2026-01-26,Wagnersalgueiro,187.00
2026-01-26,Minuto Pa,100.76
2026-01-26,Ig*Agilizetecno,354.11
2026-01-26,Shop Fartura,444.94
2026-01-25,Restaurante Estancia C,74.88
2026-01-25,Ajuste a crédito,-11.49
2026-01-25,Ifd*Ip Servicos de Ali,65.99
2026-01-25,Hna*Oboticario - Parcela 1/2,51.40
2026-01-25,Ifd*R.C. Cerqueira Ci,80.88
2026-01-25,Cursor Ai Powered Ide,328.38
2026-01-25,"IOF de ""Cursor Ai Powered Ide""",11.49
2026-01-24,Infangerloja-0002avinh,282.86
2026-01-24,Padaria Nobrega,125.10
2026-01-24,sem Parar,200.99
2026-01-24,Padaria Nobrega,121.83
2026-01-24,Bus Servicos*Clickbus,39.18
2026-01-23,Apple.Com/Bill,109.90
2026-01-23,Mercadolivre*Mercadol,31.81
2026-01-21,Pag*Parceladousa,745.80
2026-01-21,Pagamento recebido,-37417.96
2026-01-20,Mercadolivre*Instanti,82.05
2026-01-20,Mercadolivre*2produtos,157.97
2026-01-19,Auto Posto Global de C,311.71
2026-01-19,Leitura Campinas,269.90
2026-01-19,Mercado*Mercadolivre,233.40
2026-01-19,Mercado*Mercadolivre,111.36
2026-01-19,Shein *Shein.Com,369.30
2026-01-19,Ifd*Big Jack Shopping,213.95
2026-01-19,Apple.Com/Bill,32.90
2026-01-19,Samsonite e-*Americant - Parcela 1/6,333.00
2026-01-19,Ikesaki Campinas,255.18
2026-01-19,Mercado*Mercadolivre,49.89
2026-01-19,Netflix Entretenimento,59.90
2026-01-18,Villa Nobre Boutique,23.90
2026-01-18,Ifd*R.C. Cerqueira Ci,80.88
2026-01-18,Oacouguebombeef,50.40
2026-01-18,Amazon Ad Free For Pri,10.00
2026-01-18,Barbearia Silva Vinhed,125.00
2026-01-18,Villa Nobre Boutique,250.71
2026-01-18,Apple.Com/Bill,99.90
2026-01-17,Mercado*Mercadolivre - Parcela 1/4,44.59
2026-01-17,Mercado*Mercadolivre - Parcela 1/4,39.41
2026-01-17,Mercadolivre*3dmaxx,33.35
2026-01-17,Shop Fartura,696.83
2026-01-16,Apple.Com/Bill,99.90
2026-01-16,"Estorno de ""Ec *Mercadolivre""",-2967.58
2026-01-15,Restaurante Estancia C,109.78
2026-01-14,Santalollashopdom - Parcela 2/4,99.97
2026-01-14,"Estorno de ""Mercadolivre*2produto""",-349.97
2026-01-14,Leitura Dpedro - Parcela 5/6,53.29
2026-01-14,S2p*Bibliotecaca - Parcela 5/12,79.90
2026-01-14,Shopee *Factimportados - Parcela 4/4,74.26
2026-01-14,Latam Air - Parcela 4/4,1963.79
2026-01-14,Mercadolivre*Mercadol - Parcela 3/12,71.33
2026-01-14,Mercadolivre*Tecnical - Parcela 3/9,50.84
2026-01-14,Uber Uber *Trip Help.U,8.93
2026-01-14,Amazonmktplc*Rafaelrod - Parcela 2/12,138.99
2026-01-14,Leroy Merlin - Parcela 2/6,141.70
2026-01-14,Azul We*Glm63tkodama - Parcela 3/5,332.38
2026-01-14,Mercadolivre*Mercadol - Parcela 2/12,391.58
2026-01-14,Apple.Com/Bill,66.90
2026-01-14,Ec *Mercadolivre - Parcela 3/12,989.16
2026-01-14,Ibis Budget Manaus - Parcela 3/6,92.65
2026-01-14,"Estorno de ""Mercadolivre*Timeelet""",-7999.00
2026-01-14,30080 Shopping Dom Pe - Parcela 2/5,979.53
2026-01-14,Dm*Helphbomaxcom - Parcela 3/12,44.90
2026-01-14,Mercadolivre*Mercadol - Parcela 2/10,112.74
2026-01-14,Centauro Ce39 - Parcela 3/8,81.24
2026-01-14,Habitat Come*Rasco - Parcela 4/8,831.48
2026-01-14,Pg *Biblioteca Catolic - Parcela 6/10,259.99
2026-01-14,Mp *Thomasnelson - Parcela 6/8,53.73
2026-01-14,Azul We*Mmvdntkodama - Parcela 4/10,408.96
2026-01-14,Pag*Steam - Parcela 3/3,75.81
2026-01-14,Mercadolivre*2produto - Parcela 2/6,55.50
2026-01-14,Mercadolivre*Luvinimp - Parcela 4/4,124.97
2026-01-14,Jim.Com* 54296005 Pat,113.00
2026-01-14,Centauro Ce39 - Parcela 3/6,83.33
2026-01-14,Pag*Steam - Parcela 2/3,143.00
2026-01-14,Amazon Marketplace - Parcela 2/9,182.12
2026-01-14,Mercadolivre*Franspor - Parcela 3/12,69.76
2026-01-14,Localiza - Parcela 3/6,524.04
2026-01-14,Villa 88 Store - Parcela 4/6,73.30`;

// ---------------------------------------------------------------------------
// parseCsvContent
// ---------------------------------------------------------------------------
describe("parseCsvContent", () => {
  it("should parse all 199 data rows from the Nubank CSV", () => {
    const transactions = parseCsvContent(NUBANK_CSV);
    expect(transactions).toHaveLength(199);
  });

  it("should detect 'Pagamento recebido' as a payment line", () => {
    const transactions = parseCsvContent(NUBANK_CSV);
    const payments = transactions.filter((t) => t.isPayment);
    expect(payments).toHaveLength(1);
    expect(payments[0].description).toBe("Pagamento recebido");
    expect(payments[0].amount).toBe(-37417.96);
  });

  it("should correctly parse quoted descriptions with escaped double-quotes", () => {
    const transactions = parseCsvContent(NUBANK_CSV);
    const iof = transactions.find(
      (t) => t.description === 'IOF de "Getyourguide"' && t.amount === 39.88
    );
    expect(iof).toBeDefined();
    expect(iof!.date).toBe("2026-02-09");
  });

  it("should correctly parse estorno descriptions with escaped double-quotes", () => {
    const transactions = parseCsvContent(NUBANK_CSV);
    const estorno = transactions.find(
      (t) =>
        t.description === 'Estorno de "Mercadolivre*Timeelet"' &&
        t.amount === -7999.0
    );
    expect(estorno).toBeDefined();
    expect(estorno!.date).toBe("2026-01-14");
  });

  it("should preserve negative amounts for credits and refunds", () => {
    const transactions = parseCsvContent(NUBANK_CSV);
    const negatives = transactions.filter(
      (t) => t.amount < 0 && !t.isPayment
    );
    // 19 Ajuste a crédito + 5 Estornos = 24 negative non-payment entries
    expect(negatives.length).toBe(24);
  });

  it("should parse installment info from Nubank 'Parcela X/Y' format", () => {
    const transactions = parseCsvContent(NUBANK_CSV);
    const installment = transactions.find(
      (t) => t.description === "Nve*Rentcarsltda" && t.installmentNumber === 1
    );
    expect(installment).toBeDefined();
    expect(installment!.totalInstallments).toBe(3);
    expect(installment!.amount).toBe(654.58);
  });

  it("should handle simple CSV without quoted fields", () => {
    const csv = `date,title,amount
2026-01-15,Shop Fartura,100.50
2026-01-15,Uber,25.00`;
    const transactions = parseCsvContent(csv);
    expect(transactions).toHaveLength(2);
    expect(transactions[0].amount).toBe(100.5);
    expect(transactions[1].amount).toBe(25.0);
  });
});

// ---------------------------------------------------------------------------
// calculateBillTotal
// ---------------------------------------------------------------------------
describe("calculateBillTotal", () => {
  const closingDate = new Date("2026-02-14T12:00:00Z");

  it("should return R$ 51,274.23 for the real Nubank bill (closing Feb 14)", () => {
    const transactions = parseCsvContent(NUBANK_CSV);
    const total = calculateBillTotal(transactions, closingDate);
    expect(Math.round(total * 100) / 100).toBe(51274.23);
  });

  it("should exclude 'Pagamento recebido' from the total", () => {
    const transactions = parseCsvContent(NUBANK_CSV);
    const payment = transactions.find((t) => t.isPayment);
    expect(payment).toBeDefined();
    expect(payment!.amount).toBe(-37417.96);

    // Total should be positive (the payment is -37k, including it would make total much lower)
    const total = calculateBillTotal(transactions, closingDate);
    expect(total).toBeGreaterThan(40000);
  });

  it("should exclude previous-cycle estornos (before payment date) from the total", () => {
    const transactions = parseCsvContent(NUBANK_CSV);

    // These three estornos from Jan 14-16 (before payment date Jan 21) must be excluded
    const previousCycleEstornos = transactions.filter(
      (t) =>
        !t.isPayment &&
        t.amount < 0 &&
        (t.description === 'Estorno de "Ec *Mercadolivre"' ||
          t.description === 'Estorno de "Mercadolivre*2produto"' ||
          t.description === 'Estorno de "Mercadolivre*Timeelet"')
    );
    expect(previousCycleEstornos).toHaveLength(3);
    const excludedSum = previousCycleEstornos.reduce(
      (s, t) => s + t.amount,
      0
    );
    expect(Math.round(excludedSum * 100) / 100).toBe(-11316.55);

    // Verify: total + |excluded| = sum of all positive amounts + current credits
    const total = calculateBillTotal(transactions, closingDate);
    const rawTotal = transactions
      .filter((t) => !t.isPayment)
      .reduce((s, t) => s + t.amount, 0);
    expect(Math.round((total + excludedSum) * 100) / 100).toBe(
      Math.round(rawTotal * 100) / 100
    );
  });

  it("should include current-cycle estornos (after payment date) in the total", () => {
    const transactions = parseCsvContent(NUBANK_CSV);

    // Feb 13 estorno and Feb 1 estorno should be included
    const currentEstornos = transactions.filter(
      (t) =>
        !t.isPayment &&
        t.amount < 0 &&
        (t.description === 'Estorno de "Mercadolivre*4produtos"' ||
          t.description === 'Estorno de "Amazon Marketplace"')
    );
    expect(currentEstornos).toHaveLength(2);
    expect(currentEstornos.map((t) => t.amount).sort()).toEqual(
      [-364.32, -61.51].sort()
    );
  });

  it("should include all 'Ajuste a crédito' entries (all within current cycle)", () => {
    const transactions = parseCsvContent(NUBANK_CSV);
    const ajustes = transactions.filter(
      (t) =>
        !t.isPayment &&
        t.description === "Ajuste a crédito"
    );
    expect(ajustes).toHaveLength(19);
    // All ajustes are negative and all should be in the total
    const ajusteSum = Math.round(
      ajustes.reduce((s, t) => s + t.amount, 0) * 100
    ) / 100;
    expect(ajusteSum).toBe(-757.45);
  });

  it("should use closingDate-based fallback when no payment line exists", () => {
    // Create a simple CSV without any payment line
    const csv = `date,title,amount
2026-02-10,Store A,500.00
2026-02-05,Refund A,-50.00
2026-01-10,Old Refund,-200.00`;
    const transactions = parseCsvContent(csv);

    // No payment → fallback uses closingDate (Feb 14 → cycle start Jan 15)
    // Old Refund (Jan 10) is before Jan 15 → excluded
    // Refund A (Feb 5) is after Jan 15 → included
    const total = calculateBillTotal(transactions, closingDate);
    expect(total).toBe(450.0); // 500 - 50 = 450 (Old Refund excluded)
  });

  it("should handle a bill with only positive amounts", () => {
    const csv = `date,title,amount
2026-02-01,Store A,100.00
2026-02-02,Store B,200.00`;
    const transactions = parseCsvContent(csv);
    const total = calculateBillTotal(
      transactions,
      new Date("2026-02-14T12:00:00Z")
    );
    expect(total).toBe(300.0);
  });

  it("should handle a bill with payment and no other negatives", () => {
    const csv = `date,title,amount
2026-02-01,Store A,100.00
2026-01-21,Pagamento recebido,-5000.00`;
    const transactions = parseCsvContent(csv);
    const total = calculateBillTotal(
      transactions,
      new Date("2026-02-14T12:00:00Z")
    );
    expect(total).toBe(100.0);
  });

  it("should work correctly with different closing dates for the same CSV", () => {
    const transactions = parseCsvContent(NUBANK_CSV);

    // With closing date Feb 14 (actual) → payment date Jan 21 is the cutoff
    const totalFeb14 = Math.round(
      calculateBillTotal(transactions, new Date("2026-02-14T12:00:00Z")) * 100
    ) / 100;
    expect(totalFeb14).toBe(51274.23);

    // With closing date Feb 21 → same payment date Jan 21, same cutoff, same result
    const totalFeb21 = Math.round(
      calculateBillTotal(transactions, new Date("2026-02-21T12:00:00Z")) * 100
    ) / 100;
    expect(totalFeb21).toBe(51274.23);
  });

  it("should return 198 charge transactions (all except payment)", () => {
    const transactions = parseCsvContent(NUBANK_CSV);
    const charges = transactions.filter((t) => !t.isPayment);
    expect(charges).toHaveLength(198);
  });
});
