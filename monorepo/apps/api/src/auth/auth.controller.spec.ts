import { Test, TestingModule } from '@nestjs/testing';
import { AuthController } from './auth.controller';
import { GmailService } from 'src/gmail/gmail.service';
import { NERService } from 'src/nlp/ner/ner.service';
import { UsersService } from 'src/users/services/users.service';
import { JwtService } from '@nestjs/jwt';
import { User } from '@prisma/client';
import { ExpenseCategory } from 'src/users/types/transaction.enum';
import { TransactionStatus } from '@prisma/client';
import { gmail_v1 } from 'googleapis';
import { Email } from 'src/gmail/interfaces/gmail.interface';
import * as pdfParse from 'pdf-parse';
import * as fs from 'fs';
import * as path from 'path';
import { NubankNERService } from 'src/nlp/ner/nubank-ner.service';
import { BankDomains } from 'src/gmail/interfaces/bank.interface';
import { XPNERService } from 'src/nlp/ner/xp-ner.service';

describe('AuthController', () => {
  let controller: AuthController;
  let gmailService: GmailService;
  let usersService: UsersService;

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      controllers: [AuthController],
      providers: [
        {
          provide: GmailService,
          useValue: {
            getEmails: jest.fn(),
            BANKS_DOMAINS: ['bank.com'],
          },
        },
        NERService,
        NubankNERService,
        XPNERService,
        {
          provide: UsersService,
          useValue: {
            saveEmail: jest.fn(),
            saveTransactionFromEmail: jest.fn(),
            createTransaction: jest.fn(),
          },
        },
        {
          provide: JwtService,
          useValue: {
            sign: jest.fn(),
          },
        },
      ],
    }).compile();

    controller = module.get<AuthController>(AuthController);
    gmailService = module.get<GmailService>(GmailService);
    usersService = module.get<UsersService>(UsersService);
  });

  it('should process nubank email and save transaction correctly', async () => {
    const mockUser = {
      id: '123',
      email: 'test@gmail.com',
      name: '',
      accessToken: 'accessToken',
      refreshToken: 'refreshToken',
    } as User;
    const mockEmails: Email[] = [
      {
        id: 'emailId',
        body: 'Chegou a sua fatura de cartão de credito. Valor total: R$ 100,00',
        pdfText: 'PDF text',
        hasPDF: true,
        sizeEstimate: 1,
        snippet:
          'Chegou a sua fatura de cartão de credito. Valor total: R$ 100,00',
        internalDate: '1627849200000',
        senderEmail: `test@${BankDomains.NUBANK}`,
        raw: 'raw email data' as gmail_v1.Schema$Message,
      },
    ];

    // Read the PDF file and extract its text
    const pdfFilePath = path.join(__dirname, './test/nubank-fatura.pdf');
    const pdfBuffer = fs.readFileSync(pdfFilePath);
    const pdfData = await pdfParse(pdfBuffer);
    const extractedPdfText = pdfData.text;

    // Assign the extracted PDF text to the email
    mockEmails[0].pdfText = extractedPdfText;

    // Mock GmailService.getEmails
    (gmailService.getEmails as jest.Mock).mockResolvedValue(mockEmails);

    // Mock UsersService.saveEmail
    (usersService.saveEmail as jest.Mock).mockResolvedValue({
      id: 1,
      sender: `test@${BankDomains.NUBANK}`,
      internalDate: new Date(1627849200000),
    });

    // Mock UsersService.saveTransactionFromEmail
    (usersService.saveTransactionFromEmail as jest.Mock).mockResolvedValue({
      id: '123',
      subItems: [],
    });
    (usersService.createTransaction as jest.Mock).mockResolvedValue({});

    await controller.processEmailTransactions(mockUser);

    expect(gmailService.getEmails).toHaveBeenCalledWith(
      mockUser.accessToken,
      mockUser.refreshToken,
      gmailService.BANKS_DOMAINS,
    );
    expect(usersService.saveEmail).toHaveBeenCalledWith({
      body: mockEmails[0].body,
      pdfText: mockEmails[0].pdfText,
      pdfNeedsPassword: false,
      snippet: mockEmails[0].snippet,
      internalDate: new Date(1627849200000).toISOString(),
      messageId: 'emailId',
      sender: `test@${BankDomains.NUBANK}`,
      user: { connect: { id: mockUser.id } },
      raw: JSON.stringify('raw email data'),
    });

    expect(usersService.saveTransactionFromEmail).toHaveBeenCalledTimes(1);
    expect(usersService.createTransaction).toHaveBeenCalledTimes(5);

    expect(usersService.saveTransactionFromEmail).toHaveBeenNthCalledWith(1, {
      status: TransactionStatus.PENDING,
      amount: 100.0,
      dueAt: new Date(1627849200000 + 5 * 24 * 60 * 60 * 1000), // Adding 5 days
      createdAt: new Date(1627849200000),
      description: `test@${BankDomains.NUBANK}`,
      category: ExpenseCategory.CREDIT_CARD,
      email: { connect: { id: 1 } },
      user: { connect: { id: mockUser.id } },
    });
    expect(usersService.createTransaction).toHaveBeenNthCalledWith(1, {
      status: TransactionStatus.PENDING,
      amount: 103.68,
      dueAt: new Date(1627849200000 + 5 * 24 * 60 * 60 * 1000),
      createdAt: new Date('2024-06-02T12:00:00.000Z'),
      description: 'Contabilizei Tecnologi - Parcela 12/12',
      category: ExpenseCategory.CREDIT_CARD,
      email: { connect: { id: 1 } },
      user: { connect: { id: mockUser.id } },
      parent: { connect: { id: '123' } },
    });
    expect(usersService.createTransaction).toHaveBeenNthCalledWith(2, {
      status: TransactionStatus.PENDING,
      amount: 4915.0,
      dueAt: new Date(1627849200000 + 5 * 24 * 60 * 60 * 1000),
      createdAt: new Date('2024-06-13T12:00:00.000Z'),
      description: 'Localiza - Meoo',
      category: ExpenseCategory.CREDIT_CARD,
      email: { connect: { id: 1 } },
      user: { connect: { id: mockUser.id } },
      parent: { connect: { id: '123' } },
    });
    expect(usersService.createTransaction).toHaveBeenNthCalledWith(3, {
      status: TransactionStatus.PENDING,
      amount: 645.65,
      dueAt: new Date(1627849200000 + 5 * 24 * 60 * 60 * 1000),
      createdAt: new Date('2024-06-22T12:00:00.000Z'),
      description: 'Localiza - Meoo',
      category: ExpenseCategory.CREDIT_CARD,
      email: { connect: { id: 1 } },
      user: { connect: { id: mockUser.id } },
      parent: { connect: { id: '123' } },
    });
    expect(usersService.createTransaction).toHaveBeenNthCalledWith(4, {
      status: TransactionStatus.PENDING,
      amount: 169.08,
      dueAt: new Date(1627849200000 + 5 * 24 * 60 * 60 * 1000),
      createdAt: new Date('2024-06-23T12:00:00.000Z'),
      description: 'Ingresso.Com',
      category: ExpenseCategory.CREDIT_CARD,
      email: { connect: { id: 1 } },
      user: { connect: { id: mockUser.id } },
      parent: { connect: { id: '123' } },
    });
    expect(usersService.createTransaction).toHaveBeenNthCalledWith(5, {
      status: TransactionStatus.PENDING,
      amount: 146.4,
      dueAt: new Date(1627849200000 + 5 * 24 * 60 * 60 * 1000),
      createdAt: new Date('2024-06-24T12:00:00.000Z'),
      description: 'sem Par*sem Parar *',
      category: ExpenseCategory.CREDIT_CARD,
      email: { connect: { id: 1 } },
      user: { connect: { id: mockUser.id } },
      parent: { connect: { id: '123' } },
    });
  });
  it('should process xp email and save transaction correctly', async () => {
    const mockUser = {
      id: '123',
      email: 'test@gmail.com',
      name: '',
      accessToken: 'accessToken',
      refreshToken: 'refreshToken',
    } as User;
    const mockEmails: Email[] = [
      {
        id: 'emailId',
        body: 'Chegou a sua fatura de cartão de credito. Valor total: R$ 100,00',
        pdfText: 'PDF text',
        hasPDF: true,
        sizeEstimate: 1,
        snippet:
          'Chegou a sua fatura de cartão de credito. Valor total: R$ 100,00',
        internalDate: '1627849200000',
        senderEmail: `test@${BankDomains.XP}`,
        raw: 'raw email data' as gmail_v1.Schema$Message,
      },
    ];

    // Read the PDF file and extract its text
    const pdfFilePath = path.join(__dirname, './test/xp-fatura-unlocked.pdf');
    const pdfBuffer = fs.readFileSync(pdfFilePath);
    const pdfData = await pdfParse(pdfBuffer);
    const extractedPdfText = pdfData.text;

    // Assign the extracted PDF text to the email
    mockEmails[0].pdfText = extractedPdfText;

    // Mock GmailService.getEmails
    (gmailService.getEmails as jest.Mock).mockResolvedValue(mockEmails);

    // Mock UsersService.saveEmail
    (usersService.saveEmail as jest.Mock).mockResolvedValue({
      id: 1,
      sender: `test@${BankDomains.XP}`,
      internalDate: new Date(1627849200000),
    });

    // Mock UsersService.saveTransactionFromEmail
    (usersService.saveTransactionFromEmail as jest.Mock).mockResolvedValue({
      id: '123',
      subItems: [],
    });

    (usersService.createTransaction as jest.Mock).mockResolvedValue({});

    await controller.processEmailTransactions(mockUser);

    expect(gmailService.getEmails).toHaveBeenCalledWith(
      mockUser.accessToken,
      mockUser.refreshToken,
      gmailService.BANKS_DOMAINS,
    );
    expect(usersService.saveEmail).toHaveBeenCalledWith({
      body: mockEmails[0].body,
      pdfText: mockEmails[0].pdfText,
      pdfNeedsPassword: false,
      snippet: mockEmails[0].snippet,
      internalDate: new Date(1627849200000).toISOString(),
      messageId: 'emailId',
      sender: `test@${BankDomains.XP}`,
      user: { connect: { id: mockUser.id } },
      raw: JSON.stringify('raw email data'),
    });

    expect(usersService.saveTransactionFromEmail).toHaveBeenCalledTimes(1);
    expect(usersService.createTransaction).toHaveBeenCalledTimes(87);

    expect(usersService.saveTransactionFromEmail).toHaveBeenNthCalledWith(1, {
      status: TransactionStatus.PENDING,
      amount: 100.0,
      dueAt: new Date(1627849200000 + 5 * 24 * 60 * 60 * 1000), // Adding 5 days
      createdAt: new Date(1627849200000),
      description: `test@${BankDomains.XP}`,
      category: ExpenseCategory.CREDIT_CARD,
      email: { connect: { id: 1 } },
      user: { connect: { id: mockUser.id } },
    });
    expect(usersService.createTransaction).toHaveBeenNthCalledWith(1, {
      status: TransactionStatus.PENDING,
      amount: 947,
      dueAt: new Date(1627849200000 + 5 * 24 * 60 * 60 * 1000),
      createdAt: new Date(1627849200000),
      description: 'BT SHOP ELDORADO - Parcela 8/12',
      category: ExpenseCategory.CREDIT_CARD,
      email: { connect: { id: 1 } },
      user: { connect: { id: mockUser.id } },
      parent: { connect: { id: '123' } },
    });
    expect(usersService.createTransaction).toHaveBeenNthCalledWith(16, {
      status: TransactionStatus.PENDING,
      amount: 53.98,
      dueAt: new Date(1627849200000 + 5 * 24 * 60 * 60 * 1000),
      createdAt: new Date('2024-07-11T12:00:00.000Z'),
      description: 'IFD*BAR E RESTAURANTE LAC',
      category: ExpenseCategory.CREDIT_CARD,
      email: { connect: { id: 1 } },
      user: { connect: { id: mockUser.id } },
      parent: { connect: { id: '123' } },
    });
  });
});
