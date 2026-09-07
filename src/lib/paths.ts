import { existsSync } from "node:fs";
import path from "node:path";

export function resolvePublicFile(name: string): string {
  const candidates = [
    path.join(process.cwd(), "public", name),
    path.join(process.cwd(), name),
    path.join(__dirname, "../../public", name),
    path.join(__dirname, "../../../public", name),
  ];
  const found = candidates.find((file) => existsSync(file));
  if (!found) throw new Error(`Missing public/${name}`);
  return found;
}
