import { str } from "./grade.ts";

export interface ShowInput { title: string; body: string; image?: string }
export type ShowValidation = { ok: true; show: ShowInput } | { ok: false; error: string };

export const IMAGE_NAME = /^[A-Za-z0-9._-]+\.(png|svg)$/;

export function validateShow(raw: unknown): ShowValidation {
  const r = (raw ?? {}) as Record<string, unknown>;
  const title = str(r.title);
  if (!title) return { ok: false, error: "`title` is required." };
  const body = str(r.body);
  if (!body) return { ok: false, error: "`body` is required." };
  const image = str(r.image);
  if (image !== undefined && !IMAGE_NAME.test(image)) return { ok: false, error: "`image` must be a file name in viz/ ending in .png or .svg." };
  return { ok: true, show: image ? { title, body, image } : { title, body } };
}
