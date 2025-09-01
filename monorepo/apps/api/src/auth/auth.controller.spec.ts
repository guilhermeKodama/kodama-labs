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
import pdfParse from 'pdf-parse';
import * as fs from 'fs';
import * as path from 'path';
import { NubankNERService } from 'src/nlp/ner/nubank-ner.service';
import { BankDomains } from 'src/gmail/interfaces/bank.interface';
import { XPNERService } from 'src/nlp/ner/xp-ner.service';
import { TransactionsService } from 'src/users/services/transactios.service';
import { StorageService } from 'src/storage/services/storage.service';
import { PrismaService } from 'src/database/prisma.service';
import { ConfigService } from '@nestjs/config';

describe('AuthController', () => {
  let controller: AuthController;
  let gmailService: GmailService;
  let usersService: UsersService;
  let transactionsService: TransactionsService;
  let prismaService: PrismaService;
  let nerService: NERService;

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
          provide: ConfigService,
          useValue: {
            get: jest.fn(),
          },
        },
        {
          provide: UsersService,
          useValue: {
            user: jest.fn(),
            createUser: jest.fn(),
            updateUser: jest.fn(),
            upsertEmail: jest.fn(),
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
    nerService = module.get<NERService>(NERService);

    // Mock the specific Prisma call `findFirst` within saveTransactionFromEmail
    jest.spyOn(prismaService.transaction, 'findFirst').mockResolvedValue(null); // Mock null to simulate no existing transaction
    jest.spyOn(prismaService.transaction, 'create').mockResolvedValue({
      id: '123',
      amount: 5979.81, // Default amount for tests
      status: TransactionStatus.PENDING,
      dueAt: new Date(1627849200000 + 5 * 24 * 60 * 60 * 1000),
      createdAt: new Date(1627849200000),
      description: 'Test Transaction',
      category: ExpenseCategory.CREDIT_CARD,
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
    (usersService.upsertEmail as jest.Mock).mockResolvedValue({
      id: 1,
      sender: `test@${BankDomains.NUBANK}`,
      internalDate: new Date(1627849200000),
      snippet:
        'Chegou a sua fatura de cartão de credito. Valor total: R$ 5.979,80',
      body: 'Chegou a sua fatura de cartão de credito. Valor total: R$ 5.979,80',
      pdfText: mockEmails[0].pdfText,
    });

    // Mock the individual methods that get called inside saveTransactionsFromEmail
    jest.spyOn(transactionsService, 'extractTotalFromEmail').mockReturnValue(5979.81);
    jest.spyOn(transactionsService, 'extractDueAtFromEmail').mockReturnValue(
      new Date(1627849200000 + 5 * 24 * 60 * 60 * 1000)
    );

    // Mock the NER service to return expected sub-items with total matching parent
    const mockSubItems = [
      {
        description: 'Contabilizei Tecnologi - Parcela 12/12',
        date: new Date('2024-06-02T12:00:00.000Z'),
        value: 103.68,
      },
      {
        description: 'Localiza - Meoo',
        date: new Date('2024-06-13T12:00:00.000Z'),
        value: 4915.0,
      },
      {
        description: 'Localiza - Meoo',
        date: new Date('2024-06-22T12:00:00.000Z'),
        value: 645.65,
      },
      {
        description: 'Ingresso.Com',
        date: new Date('2024-06-23T12:00:00.000Z'),
        value: 169.08,
      },
      {
        description: 'sem Par*sem Parar *',
        date: new Date('2024-06-24T12:00:00.000Z'),
        value: 146.4,
      },
    ];
    
    jest.spyOn(nerService, 'extractSubItems').mockReturnValue(mockSubItems);

    // createTransaction is now handled by the Prisma mock in beforeEach

    jest
      .spyOn(transactionsService, 'createTransactions')
      .mockResolvedValue({ count: 5 } as any);

    await controller.processEmailTransactions(mockUser);

    expect(gmailService.getEmails).toHaveBeenCalledWith(
      mockUser.accessToken,
      mockUser.refreshToken,
      gmailService.BANKS_DOMAINS,
    );
    expect(usersService.upsertEmail).toHaveBeenCalledWith({
      where: { messageId: 'emailId' },
      create: {
        body: mockEmails[0].body,
        pdfText: mockEmails[0].pdfText,
        pdfNeedsPassword: false,
        snippet: mockEmails[0].snippet,
        internalDate: new Date(1627849200000).toISOString(),
        messageId: 'emailId',
        sender: `test@${BankDomains.NUBANK}`,
        user: { connect: { id: mockUser.id } },
        raw: JSON.stringify('raw email data'),
      },
      update: {},
    });

    expect(transactionsService.extractTotalFromEmail).toHaveBeenCalledTimes(1);
    expect(transactionsService.extractDueAtFromEmail).toHaveBeenCalledTimes(1);
    expect(prismaService.transaction.create).toHaveBeenCalledTimes(1);
    expect(transactionsService.createTransactions).toHaveBeenCalledTimes(1);

    // Verify that the individual methods were called correctly
    expect(transactionsService.extractTotalFromEmail).toHaveBeenCalledWith(
      expect.objectContaining({ id: 1 })
    );
    expect(transactionsService.extractDueAtFromEmail).toHaveBeenCalledWith(
      expect.objectContaining({ id: 1 })
    );
    expect(transactionsService.createTransactions).toHaveBeenCalledWith(
      expect.arrayContaining([
        expect.objectContaining({
          description: 'Contabilizei Tecnologi - Parcela 12/12',
          amount: 103.68,
        }),
        expect.objectContaining({
          description: 'Localiza - Meoo',
          amount: 4915.0,
        }),
      ])
    );
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
    (usersService.upsertEmail as jest.Mock).mockResolvedValue({
      id: 1,
      sender: mockEmails[0].senderEmail,
      internalDate: new Date(1726790400000),
      body: mockEmails[0].body,
      snippet: mockEmails[0].snippet,
      pdfText: mockEmails[0].pdfText,
    });

    // Mock the individual methods that get called inside saveTransactionsFromEmail
    jest.spyOn(transactionsService, 'extractTotalFromEmail').mockReturnValue(20149.34);
    jest.spyOn(transactionsService, 'extractDueAtFromEmail').mockReturnValue(
      new Date(1726790400000 + 5 * 24 * 60 * 60 * 1000)
    );

    // Mock the NER service to return expected sub-items for XP test
    // Create 118 sub-items that total to approximately 20149.34
    const mockXPSubItems = Array.from({ length: 118 }, (_, i) => ({
      description: `Transaction ${i + 1}`,
      date: new Date(1726790400000),
      value: Math.round(20149.34 / 118 * 100) / 100, // Distribute total evenly
    }));
    
    jest.spyOn(nerService, 'extractSubItems').mockReturnValue(mockXPSubItems);

    // Mock createTransactions method
    jest.spyOn(transactionsService, 'createTransactions').mockResolvedValue({ count: 118 } as any);

    // Override the Prisma mock for this test to return XP-specific amount
    jest.spyOn(prismaService.transaction, 'create').mockResolvedValue({
      id: '123',
      amount: 20149.34, // XP-specific amount
      status: TransactionStatus.PENDING,
      dueAt: new Date(1726790400000 + 5 * 24 * 60 * 60 * 1000),
      createdAt: new Date(1726790400000),
      description: 'Fatura XP 9/24',
      category: ExpenseCategory.CREDIT_CARD,
      subItems: [],
    } as any);

    await controller.processEmailTransactions(mockUser);

    expect(gmailService.getEmails).toHaveBeenCalledWith(
      mockUser.accessToken,
      mockUser.refreshToken,
      gmailService.BANKS_DOMAINS,
    );
    expect(usersService.upsertEmail).toHaveBeenCalledWith({
      where: { messageId: 'emailId' },
      create: {
        body: mockEmails[0].body,
        pdfText: mockEmails[0].pdfText,
        pdfNeedsPassword: false,
        snippet: mockEmails[0].snippet,
        internalDate: new Date(1726790400000).toISOString(),
        messageId: 'emailId',
        sender: `test@${BankDomains.XP}`,
        user: { connect: { id: mockUser.id } },
        raw: JSON.stringify('raw email data'),
      },
      update: {},
    });

    expect(transactionsService.extractTotalFromEmail).toHaveBeenCalledTimes(1);
    expect(transactionsService.extractDueAtFromEmail).toHaveBeenCalledTimes(1);
    expect(prismaService.transaction.create).toHaveBeenCalledTimes(1);
    expect(transactionsService.createTransactions).toHaveBeenCalledTimes(1);

    // Verify that the individual methods were called correctly
    expect(transactionsService.extractTotalFromEmail).toHaveBeenCalledWith(
      expect.objectContaining({ id: 1 })
    );
    expect(transactionsService.extractDueAtFromEmail).toHaveBeenCalledWith(
      expect.objectContaining({ id: 1 })
    );
    expect(transactionsService.createTransactions).toHaveBeenCalledWith(
      expect.arrayContaining([
        expect.objectContaining({
          description: 'Transaction 1',
          amount: 170.76, // 20149.34 / 118 ≈ 170.76
        }),
        expect.objectContaining({
          description: 'Transaction 2',
          amount: 170.76, // 20149.34 / 118 ≈ 170.76
        }),
      ])
    );
  });

  it('should not process nubank email from credit card bill renegotiation', async () => {
    const mockUser = {
      id: '123',
      email: 'test@gmail.com',
      name: '',
      accessToken: 'accessToken',
      refreshToken: 'refreshToken',
    } as User;

    const mockEmails: Email[] = [
      {
        id: 'emailId1',
        body: '',
        pdfText: null,
        hasPDF: true,
        sizeEstimate: 1,
        snippet:
          'A renegociação de pendências do seu cartão foi efetivada com sucesso. Informações importantes sobre seu parcelamento Olá, Loma, O parcelamento da sua fatura foi efetivado com sucesso. Valor Parcelado R',
        internalDate: '1627849200000',
        senderEmail: 'todomundo@nubank.com.br',
        raw: 'raw email data' as gmail_v1.Schema$Message,
        pdfBuffer: null,
      },
      {
        id: 'emailId2',
        body: '',
        pdfText: null,
        hasPDF: true,
        sizeEstimate: 1,
        snippet:
          'Fatura paga com sucesso Fatura paga com sucesso Olá, Loma O pagamento de R$ 400,00 da sua fatura foi realizado com sucesso. vJUbElOkXm35wbBPL5YD awyt8iyj8it4e3egni7ji3ttfgasby Abraços, Equipe Nubank.',
        internalDate: '1627849200000',
        senderEmail: `todomundo@nubank.com.br`,
        raw: 'raw email data' as gmail_v1.Schema$Message,
        pdfBuffer: null,
      },
      {
        id: 'emailId3',
        body: 'Chegou a sua fatura de cartão de credito. Valor total: R$ 5.979,80',
        pdfText: null,
        hasPDF: true,
        sizeEstimate: 1,
        snippet:
          'Queremos te ajudar. Olá, Loma! Vamos encontrar uma solução para a sua fatura em atraso? Com a falta de pagamento, os juros estão aumentando a cada dia. Além disso, em até 7 dias seu CPF será negativado',
        internalDate: '1627849200000',
        senderEmail: `todomundo@nubank.com.br`,
        raw: 'raw email data' as gmail_v1.Schema$Message,
        pdfBuffer: null,
      },
    ];

    // Mock GmailService.getEmails
    (gmailService.getEmails as jest.Mock).mockResolvedValue(mockEmails);

    // Mock UsersService.upsertEmail
    (usersService.upsertEmail as jest.Mock).mockResolvedValue({
      id: 1,
      sender: 'todomundo@nubank.com.br',
      internalDate: new Date(1627849200000),
      snippet: mockEmails[0].snippet,
      body: mockEmails[0].body,
      pdfText: mockEmails[0].pdfText,
    });

    // Mock TransactionsService.saveTransactionsFromEmail
    jest
      .spyOn(transactionsService, 'saveTransactionsFromEmail')
      .mockResolvedValue(undefined);

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
    expect(usersService.upsertEmail).toHaveBeenCalledWith({
      where: { messageId: 'emailId2' },
      create: {
        body: mockEmails[1].body,
        pdfText: mockEmails[1].pdfText,
        pdfNeedsPassword: true,
        snippet: mockEmails[1].snippet,
        internalDate: new Date(1627849200000).toISOString(),
        messageId: 'emailId2',
        sender: 'todomundo@nubank.com.br',
        user: { connect: { id: mockUser.id } },
        raw: JSON.stringify('raw email data'),
      },
      update: {},
    });

    expect(transactionsService.saveTransactionsFromEmail).toHaveBeenCalledTimes(
      1,
    );
    expect(transactionsService.createTransaction).toHaveBeenCalledTimes(0);
  });
});
