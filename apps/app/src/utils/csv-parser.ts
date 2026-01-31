import { TransactionType, ExpenseCategory, IncomeCategory, InvestmentCategory, type TransactionCategory } from 'src/types/api';

// ----------------------------------------------------------------------

export interface CsvRow {
  nome: string;
  vencimento: string;
  valor: string;
  categoria: string;
}

export interface ParsedTransaction {
  description: string;
  dueAt: string;
  amount: number;
  category: TransactionCategory;
  type: TransactionType;
}

export interface CsvValidationResult {
  isValid: boolean;
  errors: string[];
  warnings: string[];
  parsedTransactions: ParsedTransaction[];
  totalRows: number;
  validRows: number;
}

// ----------------------------------------------------------------------

/**
 * Maps Portuguese category names to system category enums
 */
const CATEGORY_MAPPING: Record<string, TransactionCategory> = {
  // Expense categories
  'cartão de crédito': ExpenseCategory.CREDIT_CARD,
  'credito': ExpenseCategory.CREDIT_CARD,
  'credit_card': ExpenseCategory.CREDIT_CARD,
  'alimentação': ExpenseCategory.FOOD,
  'alimentacao': ExpenseCategory.FOOD,
  'food': ExpenseCategory.FOOD,
  'moradia': ExpenseCategory.HOUSING,
  'housing': ExpenseCategory.HOUSING,
  'transporte': ExpenseCategory.TRANSPORTATION,
  'transportation': ExpenseCategory.TRANSPORTATION,
  'saúde': ExpenseCategory.HEALTH,
  'saude': ExpenseCategory.HEALTH,
  'health': ExpenseCategory.HEALTH,
  'educação': ExpenseCategory.EDUCATION,
  'educacao': ExpenseCategory.EDUCATION,
  'education': ExpenseCategory.EDUCATION,
  'lazer e entretenimento': ExpenseCategory.LEISURE_ENTERTAINMENT,
  'lazer': ExpenseCategory.LEISURE_ENTERTAINMENT,
  'entretenimento': ExpenseCategory.LEISURE_ENTERTAINMENT,
  'leisure_entertainment': ExpenseCategory.LEISURE_ENTERTAINMENT,
  'vestuário e acessórios': ExpenseCategory.CLOTHING_ACCESSORIES,
  'vestuario': ExpenseCategory.CLOTHING_ACCESSORIES,
  'acessorios': ExpenseCategory.CLOTHING_ACCESSORIES,
  'clothing_accessories': ExpenseCategory.CLOTHING_ACCESSORIES,
  'despesas pessoais': ExpenseCategory.PERSONAL_EXPENSES,
  'pessoais': ExpenseCategory.PERSONAL_EXPENSES,
  'personal_expenses': ExpenseCategory.PERSONAL_EXPENSES,
  'seguros e previdência': ExpenseCategory.INSURANCE_PENSIONS,
  'seguros': ExpenseCategory.INSURANCE_PENSIONS,
  'previdencia': ExpenseCategory.INSURANCE_PENSIONS,
  'insurance_pensions': ExpenseCategory.INSURANCE_PENSIONS,
  'investimentos': ExpenseCategory.INVESTMENTS,
  'investments': ExpenseCategory.INVESTMENTS,
  'dívidas e empréstimos': ExpenseCategory.DEBTS_LOANS,
  'dividas': ExpenseCategory.DEBTS_LOANS,
  'emprestimos': ExpenseCategory.DEBTS_LOANS,
  'debts_loans': ExpenseCategory.DEBTS_LOANS,
  'impostos': ExpenseCategory.TAXES,
  'imposto': ExpenseCategory.TAXES,
  'taxes': ExpenseCategory.TAXES,
  
  // Income categories
  'salário': IncomeCategory.SALARY,
  'salario': IncomeCategory.SALARY,
  'salary': IncomeCategory.SALARY,
  'negócio': IncomeCategory.BUSINESS,
  'negocio': IncomeCategory.BUSINESS,
  'business': IncomeCategory.BUSINESS,
  'dividendos': IncomeCategory.DIVIDENDS,
  'dividends': IncomeCategory.DIVIDENDS,
  'juros': IncomeCategory.INTEREST,
  'interest': IncomeCategory.INTEREST,
  'aluguel': IncomeCategory.RENTAL,
  'rental': IncomeCategory.RENTAL,
  'pensão': IncomeCategory.PENSION,
  'pensao': IncomeCategory.PENSION,
  'pension': IncomeCategory.PENSION,
  'presentes': IncomeCategory.GIFTS,
  'gifts': IncomeCategory.GIFTS,
  'outros': IncomeCategory.OTHER,
  'other': IncomeCategory.OTHER,
  
  // Investment categories
  'ações': InvestmentCategory.STOCKS,
  'acoes': InvestmentCategory.STOCKS,
  'stocks': InvestmentCategory.STOCKS,
  'renda fixa': InvestmentCategory.FIXED_INCOME,
  'fixed_income': InvestmentCategory.FIXED_INCOME,
  'imóveis': InvestmentCategory.REAL_ESTATE,
  'imoveis': InvestmentCategory.REAL_ESTATE,
  'real_estate': InvestmentCategory.REAL_ESTATE,
  'criptomoedas': InvestmentCategory.CRYPTOCURRENCY,
  'crypto': InvestmentCategory.CRYPTOCURRENCY,
  'cryptocurrency': InvestmentCategory.CRYPTOCURRENCY,
};

/**
 * Determines transaction type based on category
 */
function getTransactionType(category: TransactionCategory): TransactionType {
  if (Object.values(ExpenseCategory).includes(category as ExpenseCategory)) {
    return TransactionType.EXPENSE;
  }
  
  if (Object.values(IncomeCategory).includes(category as IncomeCategory)) {
    return TransactionType.INCOME;
  }
  
  if (Object.values(InvestmentCategory).includes(category as InvestmentCategory)) {
    return TransactionType.INVESTMENT;
  }
  
  // Default to expense if category is not recognized
  return TransactionType.EXPENSE;
}

/**
 * Parses a CSV file content and validates it
 */
export function parseCsvFile(csvContent: string): CsvValidationResult {
  const errors: string[] = [];
  const warnings: string[] = [];
  const parsedTransactions: ParsedTransaction[] = [];
  
  try {
    // Split into lines and remove empty lines
    const lines = csvContent.split('\n').filter(line => line.trim() !== '');
    
    if (lines.length === 0) {
      errors.push('Arquivo CSV está vazio');
      return {
        isValid: false,
        errors,
        warnings,
        parsedTransactions,
        totalRows: 0,
        validRows: 0,
      };
    }
    
    // Parse header
    const headerLine = lines[0];
    const headers = parseCsvLine(headerLine);
    
    // Validate headers
    const expectedHeaders = ['nome', 'vencimento', 'valor', 'categoria'];
    const missingHeaders = expectedHeaders.filter(header => 
      !headers.some(h => h.toLowerCase().trim() === header.toLowerCase())
    );
    
    if (missingHeaders.length > 0) {
      errors.push(`Cabeçalhos obrigatórios ausentes: ${missingHeaders.join(', ')}`);
    }
    
    // Find column indices
    const headerMap: Record<string, number> = {};
    headers.forEach((header, index) => {
      const normalizedHeader = header.toLowerCase().trim();
      if (expectedHeaders.includes(normalizedHeader)) {
        headerMap[normalizedHeader] = index;
      }
    });
    
    if (Object.keys(headerMap).length !== expectedHeaders.length) {
      errors.push('Estrutura do CSV inválida. Cabeçalhos esperados: nome, vencimento, valor, categoria');
    }
    
    // If headers are invalid, return early
    if (errors.length > 0) {
      return {
        isValid: false,
        errors,
        warnings,
        parsedTransactions,
        totalRows: lines.length - 1,
        validRows: 0,
      };
    }
    
    // Parse data rows
    let validRowCount = 0;
    
    for (let i = 1; i < lines.length; i += 1) {
      const line = lines[i];
      const rowNumber = i + 1;
      
      try {
        const columns = parseCsvLine(line);
        
        if (columns.length !== headers.length) {
          errors.push(`Linha ${rowNumber}: Número de colunas incorreto (esperado: ${headers.length}, encontrado: ${columns.length})`);
        } else {
          const row: CsvRow = {
            nome: columns[headerMap.nome]?.trim() || '',
            vencimento: columns[headerMap.vencimento]?.trim() || '',
            valor: columns[headerMap.valor]?.trim() || '',
            categoria: columns[headerMap.categoria]?.trim() || '',
          };
          
          // Validate row data
          const rowErrors = validateCsvRow(row, rowNumber);
          errors.push(...rowErrors);
          
          if (rowErrors.length === 0) {
            // Parse and add valid transaction
            const transaction = parseCsvRowToTransaction(row);
            parsedTransactions.push(transaction);
            validRowCount += 1;
          }
        }
        
      } catch (error) {
        errors.push(`Linha ${rowNumber}: Erro ao processar linha - ${error instanceof Error ? error.message : 'Erro desconhecido'}`);
      }
    }
    
    // Add warnings for common issues
    if (validRowCount === 0 && lines.length > 1) {
      warnings.push('Nenhuma linha válida encontrada no arquivo');
    } else if (validRowCount < lines.length - 1) {
      warnings.push(`${lines.length - 1 - validRowCount} linhas foram ignoradas devido a erros`);
    }
    
    return {
      isValid: errors.length === 0,
      errors,
      warnings,
      parsedTransactions,
      totalRows: lines.length - 1,
      validRows: validRowCount,
    };
    
  } catch (error) {
    errors.push(`Erro ao processar arquivo CSV: ${error instanceof Error ? error.message : 'Erro desconhecido'}`);
    return {
      isValid: false,
      errors,
      warnings,
      parsedTransactions,
      totalRows: 0,
      validRows: 0,
    };
  }
}

/**
 * Parses a single CSV line handling quoted fields
 */
function parseCsvLine(line: string): string[] {
  const result: string[] = [];
  let current = '';
  let inQuotes = false;
  
  for (let i = 0; i < line.length; i += 1) {
    const char = line[i];
    
    if (char === '"') {
      if (inQuotes && line[i + 1] === '"') {
        // Escaped quote
        current += '"';
        i += 1; // Skip next quote
      } else {
        // Toggle quote state
        inQuotes = !inQuotes;
      }
    } else if (char === ',' && !inQuotes) {
      // Field separator
      result.push(current);
      current = '';
    } else {
      current += char;
    }
  }
  
  // Add the last field
  result.push(current);
  
  return result;
}

/**
 * Validates a single CSV row
 */
function validateCsvRow(row: CsvRow, rowNumber: number): string[] {
  const errors: string[] = [];
  
  // Validate nome (description)
  if (!row.nome || row.nome.trim() === '') {
    errors.push(`Linha ${rowNumber}: Nome é obrigatório`);
  } else if (row.nome.length > 255) {
    errors.push(`Linha ${rowNumber}: Nome muito longo (máximo 255 caracteres)`);
  }
  
  // Validate vencimento (due date)
  if (!row.vencimento || row.vencimento.trim() === '') {
    errors.push(`Linha ${rowNumber}: Data de vencimento é obrigatória`);
  } else {
    const date = parseDate(row.vencimento);
    if (!date || Number.isNaN(date.getTime())) {
      errors.push(`Linha ${rowNumber}: Data de vencimento inválida (${row.vencimento}). Use o formato DD/MM/AAAA, AAAA-MM-DD ou apenas o dia (ex: 15)`);
    }
  }
  
  // Validate valor (amount)
  if (!row.valor || row.valor.trim() === '') {
    errors.push(`Linha ${rowNumber}: Valor é obrigatório`);
  } else {
    const amount = parseAmount(row.valor);
    if (Number.isNaN(amount)) {
      errors.push(`Linha ${rowNumber}: Valor inválido (${row.valor}). Use números com ponto ou vírgula como separador decimal`);
    } else if (amount <= 0) {
      errors.push(`Linha ${rowNumber}: Valor deve ser maior que zero`);
    }
  }
  
  // Validate categoria (category)
  if (!row.categoria || row.categoria.trim() === '') {
    errors.push(`Linha ${rowNumber}: Categoria é obrigatória`);
  } else {
    const mappedCategory = mapCategory(row.categoria);
    if (!mappedCategory) {
      errors.push(`Linha ${rowNumber}: Categoria inválida (${row.categoria}). Categorias válidas: ${Object.keys(CATEGORY_MAPPING).join(', ')}`);
    }
  }
  
  return errors;
}

/**
 * Parses a date string in various formats
 */
function parseDate(dateStr: string): Date | null {
  const trimmed = dateStr.trim();
  
  // Try DD/MM/YYYY format
  const ddmmyyyy = /^(\d{1,2})\/(\d{1,2})\/(\d{4})$/.exec(trimmed);
  if (ddmmyyyy) {
    const [, day, month, year] = ddmmyyyy;
    return new Date(parseInt(year, 10), parseInt(month, 10) - 1, parseInt(day, 10));
  }
  
  // Try YYYY-MM-DD format
  const yyyymmdd = /^(\d{4})-(\d{1,2})-(\d{1,2})$/.exec(trimmed);
  if (yyyymmdd) {
    const [, year, month, day] = yyyymmdd;
    return new Date(parseInt(year, 10), parseInt(month, 10) - 1, parseInt(day, 10));
  }
  
  // Try DD-MM-YYYY format
  const ddmmyyyy2 = /^(\d{1,2})-(\d{1,2})-(\d{4})$/.exec(trimmed);
  if (ddmmyyyy2) {
    const [, day, month, year] = ddmmyyyy2;
    return new Date(parseInt(year, 10), parseInt(month, 10) - 1, parseInt(day, 10));
  }
  
  // Try single number (day of current month/year)
  const singleDay = /^(\d{1,2})$/.exec(trimmed);
  if (singleDay) {
    const day = parseInt(singleDay[1], 10);
    if (day >= 1 && day <= 31) {
      const now = new Date();
      const currentYear = now.getFullYear();
      const currentMonth = now.getMonth();
      
      // Create date for the specified day of current month/year
      const targetDate = new Date(currentYear, currentMonth, day);
      
      // If the day doesn't exist in current month (e.g., Feb 30), 
      // adjust to the last day of the month
      if (targetDate.getDate() !== day) {
        return new Date(currentYear, currentMonth + 1, 0); // Last day of current month
      }
      
      return targetDate;
    }
  }
  
  // Try native Date parsing as fallback
  const nativeDate = new Date(trimmed);
  if (!Number.isNaN(nativeDate.getTime())) {
    return nativeDate;
  }
  
  return null;
}

/**
 * Parses an amount string handling various formats
 */
function parseAmount(amountStr: string): number {
  const trimmed = amountStr.trim();
  
  // Remove currency symbols and spaces
  const cleaned = trimmed.replace(/[R$\s]/g, '');
  
  // Handle Brazilian format (1.234,56) and international format (1,234.56)
  if (cleaned.includes(',') && cleaned.includes('.')) {
    // Determine which is decimal separator based on position
    const lastComma = cleaned.lastIndexOf(',');
    const lastDot = cleaned.lastIndexOf('.');
    
    if (lastComma > lastDot) {
      // Brazilian format: 1.234,56
      return parseFloat(cleaned.replace(/\./g, '').replace(',', '.'));
    }
    // International format: 1,234.56
    return parseFloat(cleaned.replace(/,/g, ''));
  }
  
  if (cleaned.includes(',')) {
    // Only comma - could be decimal separator or thousands separator
    const parts = cleaned.split(',');
    if (parts.length === 2 && parts[1].length <= 2) {
      // Likely decimal separator
      return parseFloat(cleaned.replace(',', '.'));
    }
    // Likely thousands separator
    return parseFloat(cleaned.replace(/,/g, ''));
  }
  
  // No comma, just parse as float
  return parseFloat(cleaned);
}

/**
 * Maps category string to system category
 */
function mapCategory(categoryStr: string): TransactionCategory | null {
  const normalized = categoryStr.toLowerCase().trim();
  return CATEGORY_MAPPING[normalized] || null;
}

/**
 * Converts a validated CSV row to a transaction object
 */
function parseCsvRowToTransaction(row: CsvRow): ParsedTransaction {
  const mappedCategory = mapCategory(row.categoria)!;
  const type = getTransactionType(mappedCategory);
  
  return {
    description: row.nome.trim(),
    dueAt: parseDate(row.vencimento)!.toISOString(),
    amount: parseAmount(row.valor),
    category: mappedCategory,
    type,
  };
}
