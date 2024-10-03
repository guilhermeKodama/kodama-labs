import {
  BadRequestException,
  Body,
  Controller,
  Delete,
  Get,
  Logger,
  NotFoundException,
  Param,
  Post,
  Put,
  Query,
  Req,
  UnauthorizedException,
  UploadedFile,
  UseGuards,
  UseInterceptors,
} from '@nestjs/common';
import { JwtAuthGuard } from 'src/auth/guards';
import { UsersService } from './services/users.service';
import { CreateTransactionDto } from './types/create-transaction.dto';
import { UpdateTransactionDto } from './types/update-transaction.dto';
import { SetPDFDto } from './types/set-pdf-password.dto';
import { EncryptionService } from 'src/security/services/encription.service';
import { PdfService } from 'src/nlp/ner/pdf.service';
import { FileInterceptor } from '@nestjs/platform-express';
import { UnlockPDFDto } from './types/unlock-pdf.dto';
import { StorageService } from 'src/storage/services/storage.service';
import { TransactionsService } from './services/transactios.service';
import { Email, Transaction } from '@prisma/client';

const TransactionSubItemSelect = {
  select: {
    id: true,
    amount: true,
    description: true,
    dueAt: true,
    status: true,
    category: true,
  },
};

const TransactionEmailSelect = {
  select: {
    id: true,
    sender: true,
    snippet: true,
    internalDate: true,
    pdfNeedsPassword: true,
    pdfPassword: true,
    createdAt: true,
  },
};

@Controller('user')
export class UserController {
  private readonly logger = new Logger(UserController.name);

  constructor(
    private readonly usersService: UsersService,
    private readonly encryptionService: EncryptionService,
    private readonly pdfService: PdfService,
    private readonly storageService: StorageService,
    private readonly transactionsService: TransactionsService,
  ) {}

  /**
   * This is a hack to overcome the limitations of vercel lambda functions architecture
   */
  @Get('pooling')
  @UseGuards(JwtAuthGuard)
  async getPoolingResponse(
    @Req() request: Request & { user: { id: string } },
  ): Promise<{ hasPendingProcess: boolean }> {
    const user = await this.usersService.user({ id: request.user.id });

    if (!user) {
      throw new UnauthorizedException('User not found');
    }

    return new Promise((resolve) => {
      setTimeout(() => {
        resolve({ hasPendingProcess: user.hasPendingProcess });
      }, 8000);
    });
  }
  @Get('transactions')
  @UseGuards(JwtAuthGuard)
  async getProfile(@Req() request: Request & { user: { id } }) {
    const userId = request.user?.id;

    const user = await this.usersService.user(
      { id: userId },
      {
        id: true,
        email: true,
        photo: true,
        transactions: {
          where: { parentId: null },
          include: {
            email: TransactionEmailSelect,
            subItems: TransactionSubItemSelect,
          },
        },
      },
    );

    if (!user) {
      throw new UnauthorizedException('User not found');
    }

    return {
      transactions:
        user.transactions.map(
          (transaction: Transaction & { email: Email }) => ({
            ...transaction,
            email: transaction.email
              ? {
                  ...transaction.email,
                  pdfPassword: undefined,
                  isPasswordSet: !!transaction.email?.pdfPassword,
                }
              : null,
          }),
        ) || [],
    };
  }

  @Post('/transaction')
  @UseGuards(JwtAuthGuard)
  async createTransaction(
    @Req() request: Request & { user: { id: string } },
    @Body() createTransactionDto: CreateTransactionDto,
  ) {
    const userId = request.user.id;
    if (!userId) {
      throw new UnauthorizedException('User not found');
    }

    const transaction = await this.transactionsService.createTransaction({
      ...createTransactionDto,
      user: { connect: { id: userId } },
      subItems: {
        create: createTransactionDto.subItems.map((subItem) => ({
          amount: subItem.amount,
          description: subItem.description,
          category: subItem.category || createTransactionDto.category,
          type: createTransactionDto.type, // inherit type from the parent
          status: createTransactionDto.status, // inherit status from the parent
          dueAt: createTransactionDto.dueAt, // inherit due date
          user: { connect: { id: userId } },
        })),
      },
    });

    return { transaction };
  }

  @Put('/transaction')
  @UseGuards(JwtAuthGuard)
  async updateTransaction(
    @Req() request: Request & { user: { id: string } },
    @Body() updateTransactionDto: UpdateTransactionDto,
  ) {
    const userId = request.user.id;
    if (!userId) {
      throw new UnauthorizedException('User not found');
    }

    const { id, subItems, ...data } = updateTransactionDto;

    // Fetch existing transaction with subItems
    const existingTransaction = await this.transactionsService.transaction(
      {
        id,
        userId,
      },
      {
        id: true,
        subItems: { select: { id: true } }, // Fetch only the IDs of subItems
      },
    );

    if (!existingTransaction) {
      throw new NotFoundException('Transaction not found');
    }

    // 1. Find sub-items to delete: existing in DB but not in incoming request
    const existingSubItemIds = new Set(
      existingTransaction.subItems.map((subItem) => subItem.id),
    );
    const incomingSubItemIds = new Set(
      subItems.map((subItem) => subItem.id).filter(Boolean), // Filter only subItems with an ID
    );
    const subItemsToDelete = [...existingSubItemIds].filter(
      (subItemId) => !incomingSubItemIds.has(subItemId),
    );

    // 2. Find sub-items to create: sub-items with no ID in the incoming request
    const subItemsToCreate = subItems.filter((subItem) => !subItem.id);

    // 3. Find sub-items to update: sub-items with a valid ID in both incoming and existing data
    const subItemsToUpdate = subItems.filter(
      (subItem) => subItem.id && subItem.hasChanged,
    );

    this.logger.debug({ subItemsToDelete, subItemsToCreate, subItemsToUpdate });

    // 4. Perform the update transaction, with upsert and deleteMany
    const transaction = await this.transactionsService.updateTransaction({
      where: { id, userId },
      data: {
        ...data,
        subItems: {
          upsert: subItemsToUpdate.map((subItem) => ({
            where: { id: subItem.id }, // `id` of the subItem for update
            update: {
              description: subItem.description,
              amount: subItem.amount,
              category: subItem.category,
            },
            create: {
              description: subItem.description,
              amount: subItem.amount,
              category: subItem.category || updateTransactionDto.category,
              type: updateTransactionDto.type,
              status: updateTransactionDto.status,
              dueAt: updateTransactionDto.dueAt,
              user: { connect: { id: userId } },
            },
          })),
          create: subItemsToCreate.map((subItem) => ({
            description: subItem.description,
            amount: subItem.amount,
            category: subItem.category || updateTransactionDto.category,
            type: updateTransactionDto.type,
            status: updateTransactionDto.status,
            dueAt: updateTransactionDto.dueAt,
            user: { connect: { id: userId } },
          })),
          deleteMany: {
            id: { in: subItemsToDelete }, // Deletes subItems that are not in the DTO
          },
        },
      },
    });

    return { transaction };
  }

  @Delete('/transaction/:id')
  @UseGuards(JwtAuthGuard)
  async deleteTransaction(
    @Req() request: Request & { user: { id: string } },
    @Param('id') id: string,
  ) {
    const userId = request.user.id;
    if (!userId) {
      throw new UnauthorizedException('User not found');
    }

    const transaction = await this.transactionsService.deleteTransaction({
      id,
      user: { id: userId },
    });

    return { transaction };
  }

  @Delete('/transactions')
  @UseGuards(JwtAuthGuard)
  async deleteTransactions(
    @Req() request: Request & { user: { id: string } },
    @Query('ids') ids: string,
  ) {
    const userId = request.user.id;
    if (!userId) {
      throw new UnauthorizedException('User not found');
    }

    if (!ids) {
      throw new BadRequestException('No transaction IDs provided');
    }

    const idsArray = ids.split(',').map((id) => id.trim());
    if (idsArray.length === 0) {
      throw new BadRequestException('No valid transaction IDs provided');
    }

    const transactions = await this.transactionsService.deleteTransactions({
      where: {
        id: { in: idsArray },
        userId,
      },
    });

    return { transactions };
  }

  @Post('/pdf/set-password')
  @UseGuards(JwtAuthGuard)
  async setPDFPassword(
    @Req() request: Request & { user: { id: string } },
    @Body() setPDFDto: SetPDFDto,
  ) {
    const userId = request.user.id;
    if (!userId) {
      throw new UnauthorizedException('User not found');
    }

    const { transactionId, password } = setPDFDto;

    const transaction = await this.transactionsService.transaction(
      {
        id: transactionId,
        userId,
      },
      { email: TransactionEmailSelect },
    );

    if (!transaction) {
      throw new NotFoundException('Transaction not found');
    }

    if (!transaction.email || !transaction.email?.pdfNeedsPassword) {
      throw new BadRequestException('PDF does not need a password');
    }

    const encryptedPassword = this.encryptionService.encrypt(password);

    await this.usersService.updateEmail({
      where: { id: transaction.email.id },
      data: { pdfPassword: encryptedPassword },
    });

    return { success: true };
  }

  @Post('/pdf/unlock')
  @UseGuards(JwtAuthGuard)
  @UseInterceptors(FileInterceptor('file'))
  async unlockPDFPassword(
    @Req() request: Request & { user: { id: string } },
    @Body() unlockPDFDto: UnlockPDFDto,
    @UploadedFile() file: Express.Multer.File,
  ) {
    const userId = request.user.id;
    if (!userId) {
      throw new UnauthorizedException('User not found');
    }

    if (!file || !file.buffer) {
      throw new BadRequestException('No file uploaded');
    }

    let emailRecord = (await this.usersService.email({
      id: unlockPDFDto.emailId,
    })) as Email;

    if (!emailRecord) {
      throw new NotFoundException('Email not found');
    }

    const userToUpdate = await this.usersService.user({
      id: emailRecord.userId,
    });

    /**
     * Extract text from PDF
     */
    const text = await this.pdfService.extractTextFromPdf(file.buffer);

    this.logger.debug({
      userToUpdate: userToUpdate.id,
      emailRecord: emailRecord.id,
      text: text.length,
    });

    emailRecord = await this.usersService.updateEmail({
      where: { id: emailRecord.id },
      data: { pdfText: text, pdfNeedsPassword: false },
    });

    /**
     * Extract total value
     */

    const total = this.transactionsService.extractTotalFromEmail(emailRecord);

    /**
     * Extract due date
     */

    const dueAt = this.transactionsService.extractDueAtFromEmail(emailRecord);

    this.logger.debug({
      total,
      dueAt,
    });

    await this.transactionsService.saveTransactionsFromEmail(
      emailRecord,
      userToUpdate,
      total,
      dueAt,
    );

    this.storageService
      .uploadFile(`${unlockPDFDto.emailId}.pdf`, file.buffer)
      .then(() => ({}))
      .catch((error) => {
        this.logger.error(error);
      });

    return { success: true };
  }

  @Get('/pdf/pending')
  @UseGuards(JwtAuthGuard)
  async getPendingLockedPdfs() {
    const emails = await this.usersService.emails({
      where: {
        pdfNeedsPassword: true,
        pdfPassword: { not: null },
        pdfText: '',
      },
      select: {
        id: true,
        sender: true,
        pdfPassword: true,
        user: {
          select: {
            id: true,
            email: true,
          },
        },
      },
    });

    return {
      emails: emails.map((email) => ({
        ...email,
        pdfPassword: this.encryptionService.decrypt(email.pdfPassword),
      })),
    };
  }
}
