import { type Language, useLanguage } from "./language";
import { type Bot } from "@/state/store";

export const BOT_DEFAULT_NAMES: Array<[en: string, pl: string]> = [
  ["Chief of Staff", "Szef Sztabu"],
  ["Assistant", "Asystent"],
  ["New Bot", "Nowy Bot"],
  // multibot: project-scout — domyślny zespół (lead + specjaliści)
  ["Compass", "Kompas"],
  ["Wrench", "Klucz"],
  ["Architect", "Architekt"],
  ["Generalist", "Generalista"],
  ["Frontend", "Frontend"],
  ["Backend", "Backend"],
  ["Testing", "Testowanie"],
  ["Documentation", "Dokumentacja"],
  ["Infrastructure", "Infrastruktura"],
];

export function botDisplayName(bot: Pick<Bot, "name">, language: Language): string {
  const normalized = (bot.name ?? "").trim().toLowerCase();
  if (!normalized) return bot.name ?? "";
  for (const [en, pl] of BOT_DEFAULT_NAMES) {
    if (en.trim().toLowerCase() === normalized || pl.trim().toLowerCase() === normalized) {
      return language === "pl" ? pl : en;
    }
  }
  return bot.name ?? "";
}

export function botDisplayTitle(bot: Pick<Bot, "title">, language: Language): string {
  const normalized = (bot.title ?? "").trim().toLowerCase();
  if (!normalized) return bot.title ?? "";
  for (const [en, pl] of BOT_DEFAULT_NAMES) {
    if (en.trim().toLowerCase() === normalized || pl.trim().toLowerCase() === normalized) {
      return language === "pl" ? pl : en;
    }
  }
  return bot.title ?? "";
}

export function useBotName(bot: Pick<Bot, "name">): string {
  const language = useLanguage();
  return botDisplayName(bot, language);
}

export function useBotTitle(bot: Pick<Bot, "title">): string {
  const language = useLanguage();
  return botDisplayTitle(bot, language);
}
