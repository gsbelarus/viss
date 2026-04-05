export function getPreferredLocale(locales: readonly string[] | null | undefined) {
  for (const locale of locales ?? []) {
    const normalizedLocale = locale.trim();

    if (normalizedLocale) {
      return normalizedLocale;
    }
  }

  return undefined;
}

export function getPreferredLocaleFromAcceptLanguage(
  acceptLanguage: string | null | undefined
) {
  if (!acceptLanguage) {
    return undefined;
  }

  return getPreferredLocale(
    acceptLanguage
      .split(",")
      .map((entry) => entry.split(";")[0]?.trim() ?? "")
      .filter(Boolean)
  );
}

export function formatLocalizedDateTime(
  value: string | Date | null | undefined,
  locale?: string
) {
  if (!value) {
    return "-";
  }

  const date = value instanceof Date ? value : new Date(value);

  if (Number.isNaN(date.getTime())) {
    return "-";
  }

  return date.toLocaleString(locale, {
    day: "2-digit",
    month: "2-digit",
    year: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
  });
}