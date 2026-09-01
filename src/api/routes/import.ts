import type { FastifyInstance } from "fastify";
import { importExcelBuffer } from "../../services/importExcel";

export async function importRoutes(app: FastifyInstance) {
  app.post(
    "/excel",
    {
      schema: {
        tags: ["Import"],
        summary: "Import existing Excel leads",
        description: [
          "Loads Fast Guard’s existing outbound spreadsheet into the database.",
          "",
          "**What it does:** For each row it creates or matches a **Company**, creates a **Contact** when name/email/phone exist, and creates a **Lead** with source and optional service category.",
          "",
          "**Expected columns** (headers matched loosely): company, contact, phone, email, state, city, website, lead source, status, service category.",
          "",
          "**How to call:** `multipart/form-data` with field name **`file`** (`.xlsx`). Do not send JSON — that returns 406. Example:",
          "`curl -F \"file=@leads.xlsx\" http://127.0.0.1:8081/api/import/excel`",
          "",
          "Then run **POST /api/leads/enrich-all** to classify, score, and pull contacts from websites.",
        ].join("\n"),
      },
    },
    async (req, reply) => {
      const file = await req.file();
      if (!file) return reply.code(400).send({ error: "Upload a .xlsx file as field 'file'" });
      const buffer = await file.toBuffer();
      return importExcelBuffer(buffer);
    },
  );
}
