"use server";

import { auth } from "@/auth";
import { db } from "@/lib/db";
import { can } from "@/lib/rbac";
import { revalidatePath } from "next/cache";
import { z } from "zod";

const termsTemplateSchema = z.object({
  title: z.string().min(1, "Title is required"),
  content: z.string().min(1, "Content is required"),
  isDefault: z.boolean().default(false),
});

export async function getTermsTemplates() {
  const session = await auth();
  if (!session || !session.user) return [];
  const companyId = (session.user as any).companyId;
  if (!companyId) return [];

  return db.termsTemplate.findMany({
    where: { companyId },
    orderBy: { createdAt: "desc" },
  });
}

export async function createTermsTemplate(data: z.infer<typeof termsTemplateSchema>) {
  const session = await auth();
  if (!session || !session.user) return { success: false, error: "Unauthorized" };
  if (!can(session.user as any, "company.settings.edit")) {
    return { success: false, error: "Forbidden: Missing company.settings.edit permission" };
  }
  const companyId = (session.user as any).companyId;

  try {
    const validated = termsTemplateSchema.parse(data);

    const result = await db.$transaction(async (tx) => {
      // If setting as default, clear other default templates first
      if (validated.isDefault) {
        await tx.termsTemplate.updateMany({
          where: { companyId, isDefault: true },
          data: { isDefault: false },
        });
      }

      const template = await tx.termsTemplate.create({
        data: {
          companyId,
          title: validated.title,
          content: validated.content,
          isDefault: validated.isDefault,
        },
      });

      return template;
    });

    revalidatePath("/settings/terms");
    return { success: true, template: result };
  } catch (err: any) {
    console.error("Error creating terms template:", err);
    return { success: false, error: err.message || "Failed to create terms template" };
  }
}

export async function updateTermsTemplate(
  id: string,
  data: Partial<z.infer<typeof termsTemplateSchema>>
) {
  const session = await auth();
  if (!session || !session.user) return { success: false, error: "Unauthorized" };
  if (!can(session.user as any, "company.settings.edit")) {
    return { success: false, error: "Forbidden: Missing company.settings.edit permission" };
  }
  const companyId = (session.user as any).companyId;

  try {
    const result = await db.$transaction(async (tx) => {
      const template = await tx.termsTemplate.findFirst({
        where: { id, companyId },
      });
      if (!template) throw new Error("Template not found");

      // If setting as default, clear other default templates first
      if (data.isDefault) {
        await tx.termsTemplate.updateMany({
          where: { companyId, isDefault: true },
          data: { isDefault: false },
        });
      }

      const updated = await tx.termsTemplate.update({
        where: { id },
        data: {
          title: data.title !== undefined ? data.title : undefined,
          content: data.content !== undefined ? data.content : undefined,
          isDefault: data.isDefault !== undefined ? data.isDefault : undefined,
        },
      });

      return updated;
    });

    revalidatePath("/settings/terms");
    return { success: true, template: result };
  } catch (err: any) {
    console.error("Error updating terms template:", err);
    return { success: false, error: err.message || "Failed to update terms template" };
  }
}

export async function deleteTermsTemplate(id: string) {
  const session = await auth();
  if (!session || !session.user) return { success: false, error: "Unauthorized" };
  if (!can(session.user as any, "company.settings.edit")) {
    return { success: false, error: "Forbidden: Missing company.settings.edit permission" };
  }
  const companyId = (session.user as any).companyId;

  try {
    const template = await db.termsTemplate.findFirst({
      where: { id, companyId },
    });
    if (!template) return { success: false, error: "Template not found" };

    await db.termsTemplate.delete({
      where: { id },
    });

    revalidatePath("/settings/terms");
    return { success: true };
  } catch (err: any) {
    console.error("Error deleting terms template:", err);
    return { success: false, error: err.message || "Failed to delete terms template" };
  }
}

export async function setDefaultTermsTemplate(id: string) {
  const session = await auth();
  if (!session || !session.user) return { success: false, error: "Unauthorized" };
  if (!can(session.user as any, "company.settings.edit")) {
    return { success: false, error: "Forbidden: Missing company.settings.edit permission" };
  }
  const companyId = (session.user as any).companyId;

  try {
    const result = await db.$transaction(async (tx) => {
      const template = await tx.termsTemplate.findFirst({
        where: { id, companyId },
      });
      if (!template) throw new Error("Template not found");

      await tx.termsTemplate.updateMany({
        where: { companyId, isDefault: true },
        data: { isDefault: false },
      });

      const updated = await tx.termsTemplate.update({
        where: { id },
        data: { isDefault: true },
      });

      return updated;
    });

    revalidatePath("/settings/terms");
    return { success: true, template: result };
  } catch (err: any) {
    console.error("Error setting default terms template:", err);
    return { success: false, error: err.message || "Failed to set default terms template" };
  }
}
