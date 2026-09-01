import * as XLSX from "xlsx";
import { prisma } from "../db/client";
import { col, looksLikeCompanyAsContactName, normalizeCompanyName, normalizePhone } from "../lib/normalize";
import { isPersonName, scoreLead } from "../scoring/scoreLead";
import { bumpSource, seedDefaultSources } from "./sources";

export async function importExcelBuffer(buffer: Buffer) {
  const wb = XLSX.read(buffer, { type: "buffer" });
  const sheet = wb.Sheets[wb.SheetNames[0]];
  const rows = XLSX.utils.sheet_to_json<Record<string, unknown>>(sheet);
  let imported = 0;
  let skipped = 0;

  for (const row of rows) {
    const companyName = col(row, ["company", "companyname", "account", "business"]);
    if (!companyName) {
      skipped += 1;
      continue;
    }
    const contactRaw = col(row, ["contact", "contactname", "name"]);
    const phone = normalizePhone(col(row, ["phone", "telephone", "mobile"]));
    const email = col(row, ["email", "e-mail"]);
    const state = col(row, ["state"]) ?? "FL";
    const source = col(row, ["leadsource", "source"]) || "excel";
    const service = col(row, ["servicecategory", "service", "category"]);
    const website = col(row, ["website", "url"]);
    const city = col(row, ["city"]);

    const normalizedName = normalizeCompanyName(companyName);
    let company = await prisma.company.findFirst({ where: { normalizedName } });
    if (!company) {
      company = await prisma.company.create({
        data: { name: companyName, normalizedName, phone, website, city, state, sourceUrl: website },
      });
    }

    const parts = (contactRaw || "").split(/\s+/);
    const firstName = parts[0] || null;
    const lastName = parts.slice(1).join(" ") || null;
    const dirty = looksLikeCompanyAsContactName(contactRaw) || normalizeCompanyName(contactRaw || "") === normalizedName;

    let contactId: string | undefined;
    if (email || (contactRaw && !dirty) || (phone && !dirty)) {
      const existing = email
        ? await prisma.contact.findFirst({ where: { companyId: company.id, email: email.toLowerCase() } })
        : firstName && lastName && !dirty
          ? await prisma.contact.findFirst({
              where: {
                companyId: company.id,
                firstName: { equals: firstName, mode: "insensitive" },
                lastName: { equals: lastName, mode: "insensitive" },
              },
            })
          : phone
            ? await prisma.contact.findFirst({ where: { companyId: company.id, phone } })
            : null;
      if (existing) {
        await prisma.contact.update({
          where: { id: existing.id },
          data: {
            firstName: existing.firstName || (dirty ? null : firstName),
            lastName: existing.lastName || (dirty ? null : lastName),
            email: existing.email || email?.toLowerCase(),
            phone: existing.phone || phone,
            sourceUrl: existing.sourceUrl || website,
          },
        });
        contactId = existing.id;
      } else {
        const contact = await prisma.contact.create({
          data: {
            companyId: company.id,
            firstName: dirty ? null : firstName,
            lastName: dirty ? null : lastName,
            email: email?.toLowerCase(),
            phone,
            sourceUrl: website,
          },
        });
        contactId = contact.id;
      }
    }

    const scored = scoreLead({
      hasCompany: true,
      hasPersonContact: isPersonName(firstName, lastName) && !dirty,
      hasPhoneOrEmail: Boolean(phone || email),
      hasProject: false,
      hasTrigger: false,
    });

    await prisma.lead.create({
      data: {
        companyId: company.id,
        contactId,
        score: scored.total,
        recommendedService: service,
        source,
        status: "IMPORTED",
      },
    });
    imported += 1;
  }

  await seedDefaultSources();
  await bumpSource("excel", "Existing outbound Excel", "excel", imported);
  return { imported, skipped, totalRows: rows.length };
}
