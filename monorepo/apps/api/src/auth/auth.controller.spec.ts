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
import { TransactionsService } from 'src/users/services/transactios.service';
import { StorageService } from 'src/storage/services/storage.service';
import { PrismaService } from 'src/database/prisma.service';

describe('AuthController', () => {
  let controller: AuthController;
  let gmailService: GmailService;
  let usersService: UsersService;
  let transactionsService: TransactionsService;
  let prismaService: PrismaService;

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
        TransactionsService,
        NERService,
        PrismaService,
        {
          provide: StorageService,
          useValue: {
            uploadFile: jest.fn(),
          },
        },
        {
          provide: UsersService,
          useValue: {
            user: jest.fn(),
            createUser: jest.fn(),
            updateUser: jest.fn(),
            saveEmail: jest.fn(),
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
    transactionsService = module.get<TransactionsService>(TransactionsService);
    prismaService = module.get<PrismaService>(PrismaService);

    // Mock the specific Prisma call `findFirst` within saveTransactionFromEmail
    jest.spyOn(prismaService.transaction, 'findFirst').mockResolvedValue(null); // Mock null to simulate no existing transaction
    jest.spyOn(prismaService.transaction, 'create').mockResolvedValue({
      id: '123',
      subItems: [],
    } as any);
    jest
      .spyOn(prismaService.transaction, 'update')
      .mockResolvedValue({} as any);
    jest
      .spyOn(prismaService.transactionLog, 'upsert')
      .mockResolvedValue({} as any);
  });

  it('should process nubank email and save transaction correctly', async () => {
    const mockUser = {
      id: '123',
      email: 'test@gmail.com',
      name: '',
      accessToken: 'accessToken',
      refreshToken: 'refreshToken',
    } as User;

    const pdfFilePath = path.join(__dirname, './test/nubank-fatura.pdf');

    const mockEmails: Email[] = [
      {
        id: 'emailId',
        body: 'Chegou a sua fatura de cartão de credito. Valor total: R$ 5.979,80',
        pdfText: 'PDF text',
        hasPDF: true,
        sizeEstimate: 1,
        snippet:
          'Chegou a sua fatura de cartão de credito. Valor total: R$ 5.979,80',
        internalDate: '1627849200000',
        senderEmail: `test@${BankDomains.NUBANK}`,
        raw: 'raw email data' as gmail_v1.Schema$Message,
        pdfBuffer: fs.readFileSync(pdfFilePath),
      },
    ];

    // Read the PDF file and extract its text

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
      snippet:
        'Chegou a sua fatura de cartão de credito. Valor total: R$ 5.979,80',
      body: 'Chegou a sua fatura de cartão de credito. Valor total: R$ 5.979,80',
      pdfText: mockEmails[0].pdfText,
    });

    // Mock UsersService.saveTransactionFromEmail
    jest
      .spyOn(transactionsService, 'saveTransactionFromEmail')
      // @ts-expect-error test
      .mockResolvedValue({
        id: '123',
        amount: 5979.8,
        subItems: [],
      });

    jest
      .spyOn(transactionsService, 'createTransaction')
      // @ts-expect-error test
      .mockResolvedValue({});

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

    expect(transactionsService.saveTransactionFromEmail).toHaveBeenCalledTimes(
      1,
    );
    expect(transactionsService.createTransaction).toHaveBeenCalledTimes(5);

    expect(
      transactionsService.saveTransactionFromEmail,
    ).toHaveBeenNthCalledWith(1, {
      status: TransactionStatus.PENDING,
      amount: 5979.8,
      dueAt: new Date(1627849200000 + 5 * 24 * 60 * 60 * 1000), // Adding 5 days
      createdAt: new Date(1627849200000),
      description: 'Fatura Nubank 8/21',
      category: ExpenseCategory.CREDIT_CARD,
      email: { connect: { id: 1 } },
      user: { connect: { id: mockUser.id } },
    });
    expect(transactionsService.createTransaction).toHaveBeenNthCalledWith(1, {
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
    expect(transactionsService.createTransaction).toHaveBeenNthCalledWith(2, {
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
    expect(transactionsService.createTransaction).toHaveBeenNthCalledWith(3, {
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
    expect(transactionsService.createTransaction).toHaveBeenNthCalledWith(4, {
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
    expect(transactionsService.createTransaction).toHaveBeenNthCalledWith(5, {
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

    const pdfFilePath = path.join(
      __dirname,
      './test/ef63b2ef-acc8-4fe7-b3ff-8817b696070d.pdf',
    );

    const mockEmails: Email[] = [
      {
        id: 'emailId',
        body: 'A fatura do seu Cartão XP Visa Infinite com vencimento em 20/09 fechou! O valor total desta fatura é de R$ 20.149,34',
        pdfText: 'PDF text',
        hasPDF: true,
        sizeEstimate: 1,
        snippet:
          'A fatura do seu Cartão XP Visa Infinite com vencimento em 20/09 fechou! O valor total desta fatura é de R$ 20.149,34',
        internalDate: '1726790400000',
        senderEmail: `test@${BankDomains.XP}`,
        raw: 'raw email data' as gmail_v1.Schema$Message,
        pdfBuffer: fs.readFileSync(pdfFilePath),
      },
    ];

    // Read the PDF file and extract its text
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
      sender: mockEmails[0].senderEmail,
      internalDate: new Date(1726790400000),
      body: mockEmails[0].body,
      snippet: mockEmails[0].snippet,
      pdfText: mockEmails[0].pdfText,
    });

    // Mock UsersService.saveTransactionFromEmail
    jest
      .spyOn(transactionsService, 'saveTransactionFromEmail')
      // @ts-expect-error test
      .mockResolvedValue({
        id: '123',
        amount: 20149.34,
        subItems: [],
      });

    jest
      .spyOn(transactionsService, 'createTransaction')
      // @ts-expect-error test
      .mockResolvedValue({});

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
      internalDate: new Date(1726790400000).toISOString(),
      messageId: 'emailId',
      sender: `test@${BankDomains.XP}`,
      user: { connect: { id: mockUser.id } },
      raw: JSON.stringify('raw email data'),
    });

    expect(transactionsService.saveTransactionFromEmail).toHaveBeenCalledTimes(
      1,
    );
    expect(transactionsService.createTransaction).toHaveBeenCalledTimes(118);

    expect(
      transactionsService.saveTransactionFromEmail,
    ).toHaveBeenNthCalledWith(1, {
      status: TransactionStatus.PENDING,
      amount: 20149.34,
      dueAt: new Date(1726790400000 + 5 * 24 * 60 * 60 * 1000), // Adding 5 days
      createdAt: new Date(1726790400000),
      description: 'Fatura XP 9/24',
      category: ExpenseCategory.CREDIT_CARD,
      email: { connect: { id: 1 } },
      user: { connect: { id: mockUser.id } },
    });
    expect(transactionsService.createTransaction).toHaveBeenNthCalledWith(1, {
      status: TransactionStatus.PENDING,
      amount: 947,
      dueAt: new Date(1726790400000 + 5 * 24 * 60 * 60 * 1000),
      createdAt: new Date(1726790400000),
      description: 'BT SHOP ELDORADO - Parcela 9/12',
      category: ExpenseCategory.CREDIT_CARD,
      email: { connect: { id: 1 } },
      user: { connect: { id: mockUser.id } },
      parent: { connect: { id: '123' } },
    });
    expect(transactionsService.createTransaction).toHaveBeenNthCalledWith(89, {
      status: TransactionStatus.PENDING,
      amount: 3.35,
      dueAt: new Date(1726790400000 + 5 * 24 * 60 * 60 * 1000),
      createdAt: new Date('2024-09-03T12:00:00.000Z'),
      description: 'IOF Transacoes Exterior R$',
      category: ExpenseCategory.CREDIT_CARD,
      email: { connect: { id: 1 } },
      user: { connect: { id: mockUser.id } },
      parent: { connect: { id: '123' } },
    });
  });
});
