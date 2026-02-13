import { createRouter } from "@capital/server/lib/create-app";

// Investment Accounts
import * as getInvestmentAccounts from "./get-investment-accounts";
import * as postInvestmentAccount from "./post-investment-account";
import * as putInvestmentAccount from "./put-investment-account";
import * as deleteInvestmentAccount from "./delete-investment-account";

// Investment Holdings
import * as getInvestmentHoldings from "./get-investment-holdings";
import * as postInvestmentHolding from "./post-investment-holding";
import * as putInvestmentHolding from "./put-investment-holding";
import * as deleteInvestmentHolding from "./delete-investment-holding";

// Investment Transactions
import * as getInvestmentTransactions from "./get-investment-transactions";
import * as postInvestmentTransaction from "./post-investment-transaction";
import * as putInvestmentTransaction from "./put-investment-transaction";
import * as deleteInvestmentTransaction from "./delete-investment-transaction";

// Fund / Withdraw
import * as fundWithdraw from "./post-fund-withdraw";

// Portfolio Summary
import * as getPortfolioSummary from "./get-portfolio-summary";

const router = createRouter()
  // Accounts
  .openapi(getInvestmentAccounts.route, getInvestmentAccounts.handler)
  .openapi(postInvestmentAccount.route, postInvestmentAccount.handler)
  .openapi(putInvestmentAccount.route, putInvestmentAccount.handler)
  .openapi(deleteInvestmentAccount.route, deleteInvestmentAccount.handler)
  // Fund / Withdraw
  .openapi(fundWithdraw.fundRoute, fundWithdraw.fundHandler)
  .openapi(fundWithdraw.withdrawRoute, fundWithdraw.withdrawHandler)
  // Holdings
  .openapi(getInvestmentHoldings.route, getInvestmentHoldings.handler)
  .openapi(postInvestmentHolding.route, postInvestmentHolding.handler)
  .openapi(putInvestmentHolding.route, putInvestmentHolding.handler)
  .openapi(deleteInvestmentHolding.route, deleteInvestmentHolding.handler)
  // Transactions
  .openapi(getInvestmentTransactions.route, getInvestmentTransactions.handler)
  .openapi(postInvestmentTransaction.route, postInvestmentTransaction.handler)
  .openapi(putInvestmentTransaction.route, putInvestmentTransaction.handler)
  .openapi(deleteInvestmentTransaction.route, deleteInvestmentTransaction.handler)
  // Portfolio
  .openapi(getPortfolioSummary.route, getPortfolioSummary.handler);

export default router;
