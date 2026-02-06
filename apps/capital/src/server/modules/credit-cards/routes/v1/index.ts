import { createRouter } from "@capital/server/lib/create-app";

import * as getCreditCards from "./get-credit-cards";
import * as postCreditCard from "./post-credit-card";
import * as putCreditCard from "./put-credit-card";
import * as deleteCreditCard from "./delete-credit-card";
import * as getBills from "./get-bills";
import * as postBillUpload from "./post-bill-upload";
import * as getBillTransactions from "./get-bill-transactions";
import * as getInstallments from "./get-installments";
import * as postBillExpense from "./post-bill-expense";
import * as deleteBill from "./delete-bill";
import * as putBillTransaction from "./put-bill-transaction";
import * as putBillLink from "./put-bill-link";

const router = createRouter()
  .openapi(getCreditCards.route, getCreditCards.handler)
  .openapi(postCreditCard.route, postCreditCard.handler)
  .openapi(putCreditCard.route, putCreditCard.handler)
  .openapi(deleteCreditCard.route, deleteCreditCard.handler)
  .openapi(getBills.route, getBills.handler)
  .openapi(postBillUpload.route, postBillUpload.handler)
  .openapi(getBillTransactions.route, getBillTransactions.handler)
  .openapi(getInstallments.route, getInstallments.handler)
  .openapi(postBillExpense.route, postBillExpense.handler)
  .openapi(deleteBill.route, deleteBill.handler)
  .openapi(putBillTransaction.route, putBillTransaction.handler)
  .openapi(putBillLink.route, putBillLink.handler);

export default router;
