import { PrismaClient, Role, ItemType, ValuationMethod, MasterStatus, CustomerType, CustomerStatus } from "@prisma/client";
import bcrypt from "bcryptjs";

const prisma = new PrismaClient();

async function main() {
  console.log("Starting seeding process...");

  // 1. Demo Company
  const company = await prisma.company.upsert({
    where: { id: "demo-company-id" },
    update: {
      address: "Plot No. 45, Industrial Area, Phase 1, New Delhi",
      gstin: "07AAAAA1111A1Z1",
      city: "New Delhi",
      governingPlace: "Delhi, India",
    },
    create: {
      id: "demo-company-id",
      name: "Saarlekha Industries Pvt Ltd",
      address: "Plot No. 45, Industrial Area, Phase 1, New Delhi",
      gstin: "07AAAAA1111A1Z1",
      city: "New Delhi",
      governingPlace: "Delhi, India",
    },
  });
  console.log(`Created Company: ${company.name}`);

  // 2. Departments
  const depts = [
    { code: "SALES", name: "Sales & Marketing" },
    { code: "DISPATCH", name: "Dispatch & Logistics" },
    { code: "ACC", name: "Finance & Accounts" },
  ];
  const createdDepts: Record<string, any> = {};
  for (const dept of depts) {
    createdDepts[dept.code] = await prisma.department.upsert({
      where: { companyId_code: { companyId: company.id, code: dept.code } },
      update: {},
      create: { companyId: company.id, code: dept.code, name: dept.name },
    });
  }
  console.log("Seeded Departments");
  const salesDept = createdDepts["SALES"];

  // 3. Users (Password: password123)
  const passwordHash = await bcrypt.hash("password123", 10);
  const users = [
    { email: "owner@saarlekha.in", name: "Harish Sharma", role: Role.OWNER },
    { email: "admin@saarlekha.in", name: "Ravi Kumar", role: Role.ADMIN },
    { email: "sales@saarlekha.in", name: "Sanjay Gupta", role: Role.PURCHASE_MANAGER },
    { email: "dispatch@saarlekha.in", name: "Manoj Singh", role: Role.STORE_KEEPER },
    { email: "accounts@saarlekha.in", name: "Neeta Patel", role: Role.ACCOUNTS },
  ];
  for (const u of users) {
    const createdUser = await prisma.user.upsert({
      where: { companyId_email: { companyId: company.id, email: u.email } },
      update: { role: u.role },
      create: {
        companyId: company.id,
        email: u.email,
        name: u.name,
        passwordHash,
        role: u.role,
        deptId: salesDept?.id,
      },
    });
    await prisma.companyMembership.upsert({
      where: { companyId_userId: { companyId: company.id, userId: createdUser.id } },
      update: { role: u.role, status: "ACTIVE" },
      create: { companyId: company.id, userId: createdUser.id, role: u.role, status: "ACTIVE", isPrimary: true },
    });
    await prisma.notificationPref.upsert({
      where: { companyId_userId: { companyId: company.id, userId: createdUser.id } },
      update: {},
      create: { companyId: company.id, userId: createdUser.id, inApp: true, email: false, emailDigest: "DAILY" },
    });
  }
  console.log("Seeded Users");

  // 4. Warehouses (Stores) & Bins
  const mainStore = await prisma.store.upsert({
    where: { companyId_code: { companyId: company.id, code: "FG" } },
    update: {},
    create: { companyId: company.id, code: "FG", name: "Finished Goods Warehouse", status: MasterStatus.ACTIVE },
  });
  await prisma.bin.upsert({
    where: { storeId_code: { storeId: mainStore.id, code: "A1-B2" } },
    update: {},
    create: { storeId: mainStore.id, code: "A1-B2" },
  });
  // default dispatch store on the company
  await prisma.company.update({ where: { id: company.id }, data: { defaultStoreId: mainStore.id } });
  console.log("Seeded Warehouse & Bin");

  // 5. Item code scheme + categories
  await prisma.itemCodeScheme.upsert({
    where: { companyId: company.id },
    update: {},
    create: { companyId: company.id, separator: "-", segments: [{ type: "PREFIX" }, { type: "SERIAL", width: 4 }] },
  });
  const catFG = await prisma.itemCategory.upsert({
    where: { companyId_code: { companyId: company.id, code: "FG" } },
    update: {},
    create: { companyId: company.id, code: "FG", name: "Finished Goods" },
  });

  // 6. Products (sellable finished goods)
  await prisma.item.upsert({
    where: { companyId_code: { companyId: company.id, code: "FG-0001" } },
    update: {},
    create: {
      companyId: company.id,
      code: "FG-0001",
      name: "Steel Bracket Assembly",
      description: "Powder-coated steel mounting bracket, 200mm",
      categoryId: catFG.id,
      type: ItemType.FINISHED_GOOD,
      baseUom: "PCS",
      hsnCode: "73269099",
      gstRate: 18,
      valuation: ValuationMethod.WEIGHTED_AVG,
    },
  });
  await prisma.item.upsert({
    where: { companyId_code: { companyId: company.id, code: "FG-0002" } },
    update: {},
    create: {
      companyId: company.id,
      code: "FG-0002",
      name: "Industrial Hinge 6 inch",
      description: "Heavy-duty galvanized hinge",
      categoryId: catFG.id,
      type: ItemType.FINISHED_GOOD,
      baseUom: "PCS",
      hsnCode: "83024110",
      gstRate: 18,
      valuation: ValuationMethod.WEIGHTED_AVG,
    },
  });
  console.log("Seeded Products");

  // 7. Customers (debtors)
  await prisma.customer.upsert({
    where: { companyId_code: { companyId: company.id, code: "CUST-00001" } },
    update: {},
    create: {
      companyId: company.id,
      code: "CUST-00001",
      name: "Metro Engineering Works",
      type: CustomerType.B2B,
      gstin: "07CCCCC3333C3Z3",
      stateCode: "07",
      billingAddress: "B-12, Okhla Industrial Estate, New Delhi",
      paymentTerms: "Net 30 Days",
      creditDays: 30,
      creditLimit: 500000,
      status: CustomerStatus.APPROVED,
    },
  });
  await prisma.customer.upsert({
    where: { companyId_code: { companyId: company.id, code: "CUST-00002" } },
    update: {},
    create: {
      companyId: company.id,
      code: "CUST-00002",
      name: "Sunrise Fabricators",
      type: CustomerType.B2B,
      gstin: "27DDDDD4444D4Z4",
      stateCode: "27",
      billingAddress: "Plot 9, MIDC, Pune, Maharashtra",
      paymentTerms: "Net 15 Days",
      creditDays: 15,
      creditLimit: 300000,
      status: CustomerStatus.APPROVED,
    },
  });
  console.log("Seeded Customers");

  console.log("Seeding completed successfully!");
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
