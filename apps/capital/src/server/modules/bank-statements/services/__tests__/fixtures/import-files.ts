/**
 * Small statement files for the import dialog's analyze and commit tests:
 * a bank OFX (account 98765-4, Sept 1-15 2026), a card OFX for the card
 * ending in 1234 (the ledger fixture's card, closing on the 5th) and a
 * Nubank card CSV.
 */

export const BANK_ACCOUNT_NUMBER = "98765-4";

const trn = (type: string, date: string, amount: string, fitId: string, memo: string) => `<STMTTRN>
<TRNTYPE>${type}</TRNTYPE>
<DTPOSTED>${date}000000[-3:BRT]</DTPOSTED>
<TRNAMT>${amount}</TRNAMT>
<FITID>${fitId}</FITID>
<MEMO>${memo}</MEMO>
</STMTTRN>`;

export const BANK_FITIDS = {
  UBER: "s3-bank-uber",
  PETZ: "s3-bank-petz",
  SALARY: "s3-bank-salary",
  IFOOD: "s3-bank-ifood",
  BILL: "s3-bank-bill",
  ALREADY: "s3-bank-already",
} as const;

export const BANK_OFX = `OFXHEADER:100
DATA:OFXSGML
VERSION:102
<OFX>
<SIGNONMSGSRSV1>
<SONRS>
<FI>
<ORG>NU PAGAMENTOS S.A.</ORG>
<FID>260</FID>
</FI>
</SONRS>
</SIGNONMSGSRSV1>
<BANKMSGSRSV1>
<STMTTRNRS>
<STMTRS>
<CURDEF>BRL</CURDEF>
<BANKACCTFROM>
<BANKID>0260</BANKID>
<BRANCHID>1</BRANCHID>
<ACCTID>${BANK_ACCOUNT_NUMBER}</ACCTID>
<ACCTTYPE>CHECKING</ACCTTYPE>
</BANKACCTFROM>
<BANKTRANLIST>
<DTSTART>20260901000000[-3:BRT]</DTSTART>
<DTEND>20260915000000[-3:BRT]</DTEND>
${trn("DEBIT", "20260902", "-23.40", BANK_FITIDS.UBER, "Compra no débito - UBER *TRIP")}
${trn("DEBIT", "20260903", "-189.90", BANK_FITIDS.PETZ, "Compra no débito - PAG*PETZ")}
${trn("CREDIT", "20260905", "5000.00", BANK_FITIDS.SALARY, "Transferência recebida pelo Pix - ACME CONSULTORIA - 11.111.111/0001-11 - BCO X")}
${trn("DEBIT", "20260904", "-86.90", BANK_FITIDS.IFOOD, "Compra no débito - IFOOD *RESTAURANTE")}
${trn("DEBIT", "20260912", "-1500.00", BANK_FITIDS.BILL, "Pagamento de fatura")}
${trn("DEBIT", "20260910", "-42.00", BANK_FITIDS.ALREADY, "Compra no débito - PADARIA")}
</BANKTRANLIST>
<LEDGERBAL>
<BALAMT>3157.80</BALAMT>
<DTASOF>20260915000000[-3:BRT]</DTASOF>
</LEDGERBAL>
</STMTRS>
</STMTTRNRS>
</BANKMSGSRSV1>
</OFX>`;

/** Card bill as OFX (<CCSTMTRS>), card ending in 1234: a charge, a refund, the previous bill's payment and an installment. */
export const CARD_OFX = `OFXHEADER:100
DATA:OFXSGML
VERSION:102
<OFX>
<SIGNONMSGSRSV1>
<SONRS>
<FI>
<ORG>NU PAGAMENTOS S.A.</ORG>
</FI>
</SONRS>
</SIGNONMSGSRSV1>
<CREDITCARDMSGSRSV1>
<CCSTMTTRNRS>
<CCSTMTRS>
<CURDEF>BRL
<CCACCTFROM>
<ACCTID>5502********1234
</CCACCTFROM>
<BANKTRANLIST>
<DTSTART>20260806
<DTEND>20260905
<STMTTRN>
<TRNTYPE>DEBIT
<DTPOSTED>20260810120000[0:GMT]
<TRNAMT>-45.90
<FITID>cc1
<MEMO>Uber *Trip
</STMTTRN>
<STMTTRN>
<TRNTYPE>CREDIT
<DTPOSTED>20260820120000[0:GMT]
<TRNAMT>20.00
<FITID>cc2
<MEMO>Estorno Amazon
</STMTTRN>
<STMTTRN>
<TRNTYPE>CREDIT
<DTPOSTED>20260814120000[0:GMT]
<TRNAMT>500.00
<FITID>cc3
<MEMO>Pagamento recebido
</STMTTRN>
<STMTTRN>
<TRNTYPE>DEBIT
<DTPOSTED>20260712120000[0:GMT]
<TRNAMT>-199.00
<FITID>cc4
<MEMO>Loja Eletronicos - Parcela 2/6
</STMTTRN>
<STMTTRN>
<TRNTYPE>DEBIT
<DTPOSTED>20260902120000[0:GMT]
<TRNAMT>-64.30
<FITID>cc5
<MEMO>DROGASIL 1234
</STMTTRN>
</BANKTRANLIST>
</CCSTMTRS>
</CCSTMTTRNRS>
</CREDITCARDMSGSRSV1>
</OFX>`;

/** Nubank bill CSV (date,title,amount): three purchases and a payment line. */
export const CARD_CSV = `date,title,amount
2026-08-20,Netflix.com,55.90
2026-08-21,Mercado Livre,120.00
2026-08-22,Pagamento recebido,-500.00
2026-09-01,Padaria Real,12.50
`;
