-- CreateIndex
-- One (bankName, accountNumber) pair can only ever belong to one row in
-- the whole table — a bank account belongs to exactly one person, so the
-- same account number at the same bank can't be registered twice, whether
-- by the same user or two different ones.
CREATE UNIQUE INDEX "BankAccount_bankName_accountNumber_key" ON "BankAccount"("bankName", "accountNumber");
