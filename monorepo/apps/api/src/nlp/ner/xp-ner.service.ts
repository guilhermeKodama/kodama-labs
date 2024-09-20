/**
 * @name XPNERService
 * @summary This service is responsible for extracting relevant information from XP emails or PDF statements.
 */

import { Injectable, Logger } from '@nestjs/common';
import { SubItem } from '../types/email.interface';

@Injectable()
export class XPNERService {
  private readonly logger = new Logger(XPNERService.name);

  /**
   * @example Extracts sub-items from a credit card PDF text.
   *    '16/12/23BT SHOP ELDORADO - Parcela 8/12947,000,00\n' +
        '26/12/23RESERVA STONE - Parcela 8/10319,200,00\n' +
        '21/01/24PG *REVITALE REDS - Parcela 7/12108,080,00\n' +
        '01/04/24PG *GUILHERME FRE - Parcela 5/1249,920,00\n' +
        '04/04/24OFICINA SHOPPING - Parcela 5/7299,040,00\n' +
        '05/04/24MP*LOGITECH - Parcela 5/7128,090,00\n' +
        '21/04/24LATAM SITE - Parcela 4/41.009,230,00\n' +
        '21/04/24AMAZON MARKETPLACE - Parcela 4/10355,760,00\n' +
        '01/05/24CAPS ANALIA FRANCO COM - Parcela 4/10118,000,00\n' +
        '06/05/24ANA PAULA CALIMAN SOCIE - Parcela 4/61.083,330,00\n' +
        '28/05/24MP*MERCADOLIVRE - Parcela 3/10299,200,00\n' +
        '31/05/24APPLE.COM/BR - Parcela 3/12183,160,00\n' +
        '13/06/24EC *INSIDERSTORE - Parcela 2/4253,250,00\n' +
        '01/07/24MERCADOLIVRE*MNLDISTRI - Parcela 2/1084,980,00\n' +
        '09/07/24PP *GORILSHIELD - Parcela 2/2459,840,00\n' +
        '11/07/24IFD*BAR E RESTAURANTE LAC53,980,00\n' +
        '11/07/24APPLE.COM/BILL61,900,00\n' +
        '12/07/24IFD*BAR E RESTAURANTE LAC54,980,00\n' +
        '12/07/24APPLE.COM/BILL19,900,00\n' +
   */

  extractSubItemsFromCreditCardPDFText(
    text: string,
    creditCardBillDate: Date,
  ): SubItem[] {
    const subItems: SubItem[] = [];

    // Regex patterns for parcel formats
    const regexXYY =
      /(\d{2}\/\d{2}\/\d{2})\s*([^\d]+?-\s*Parcela\s*\d+\/\d{2})\s*(\d{1,3}(?:\.\d{3})*,\d{2})/;
    const regexXX =
      /(\d{2}\/\d{2}\/\d{2})\s*([^\d]+?-\s*Parcela\s*\d+\/\d)\s*(\d{1,3}(?:\.\d{3})*,\d{2})/;

    // Generic regex pattern for non-parcel items
    const regexNonParcel =
      /(\d{2}\/\d{2}\/\d{2})\s*([^\d]+?)\s*(\d{1,3}(?:\.\d{3})*,\d{2})/;

    // Split the input text into lines
    const lines = text.split('\n');
    for (let line of lines) {
      let isParcel = false;
      line = line.trim();
      if (!line) continue; // Skip empty lines

      let match = null;

      if (line.includes('Parcela')) {
        isParcel = true;
        // Check if the line contains the "/1" pattern to determine parcel format
        if (line.includes('/1')) {
          // Apply the regex for the x/yy pattern
          match = regexXYY.exec(line);
        } else {
          // Apply the regex for the x/x pattern
          match = regexXX.exec(line);
        }
      } else {
        // Use the generic regex pattern for non-parcel items
        match = regexNonParcel.exec(line);
      }

      if (match) {
        const dateString = match[1].trim();
        const [day, month, year] = dateString.split('/');
        const fullYear = parseInt(`20${year}`);

        // we do this because we dont want this transaction to appear in the past.
        const dateObject = isParcel
          ? creditCardBillDate
          : new Date(
              Date.UTC(
                fullYear,
                parseInt(month, 10) - 1,
                parseInt(day, 10),
                12,
                0,
                0,
              ),
            );

        const description = match[2].trim();
        const value = parseFloat(match[3].replace(/\./g, '').replace(',', '.'));

        subItems.push({ date: dateObject, description, value });
      }
    }

    return subItems;
  }
}
