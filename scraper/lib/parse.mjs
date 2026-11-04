// HTML parsing for numbeo.com. Regex-based on purpose: the pages are stable,
// server-rendered tables and we want zero dependencies.

export function decodeEntities(s) {
  return s
    .replace(/&#x([0-9a-f]+);/gi, (_, h) => String.fromCodePoint(parseInt(h, 16)))
    .replace(/&#(\d+);/g, (_, d) => String.fromCodePoint(Number(d)))
    .replace(/&nbsp;/g, " ")
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'");
}

const stripTags = (s) => decodeEntities(s.replace(/<[^>]*>/g, " ")).replace(/\s+/g, " ").trim();

/** "1,616.00" -> 1616 ; "—"/"-"/"" -> null */
export function toNumber(s) {
  if (s == null) return null;
  const t = stripTags(String(s)).replace(/[^\d.,-]/g, "");
  if (!t || t === "-" || t === ".") return null;
  const n = Number(t.replace(/,/g, ""));
  return Number.isFinite(n) ? n : null;
}

/** All country names linked from the cost-of-living landing page. */
export function parseCountries(html) {
  const out = [];
  const seen = new Set();
  for (const m of html.matchAll(/country_result\.jsp\?country=([^"'&#]+)/g)) {
    const name = decodeURIComponent(m[1]).replace(/\+/g, " ").trim();
    if (!name || seen.has(name)) continue;
    seen.add(name);
    out.push(name);
  }
  return out;
}

/** Cities offered in the "Select city in <country>" dropdown. */
export function parseCityList(html) {
  const start = html.indexOf('<select name="city"');
  if (start === -1) return [];
  const end = html.indexOf("</select>", start);
  const seg = html.slice(start, end === -1 ? start + 200000 : end);
  const cities = [];
  const seen = new Set();
  for (const m of seg.matchAll(/<option value="([^"]*)"/g)) {
    const name = decodeEntities(m[1]).trim();
    if (!name || name.startsWith("---") || seen.has(name)) continue;
    seen.add(name);
    cities.push(name);
  }
  return cities;
}

/**
 * One city's cost-of-living page (fetched with displayCurrency=USD).
 * Returns the raw fields we care about; anything missing stays null.
 */
export function parseCityPage(html, url) {
  const h1 = html.match(/<h1[^>]*>([\s\S]*?)<\/h1>/);
  const heading = h1 ? stripTags(h1[1]) : "";
  const inCity = heading.replace(/^Cost of Living in\s+/i, "").trim();

  // "Cost of Living in Ajax, ON. Oct 2026. Prices in Ajax" -> Oct 2026
  const title = stripTags((html.match(/<title>([\s\S]*?)<\/title>/) || [])[1] || "");
  const dataDate = (title.match(/\b([A-Z][a-z]{2})\s+(\d{4})\b/) || []).slice(1).join(" ") || null;

  // label -> first value in the price table
  const fields = new Map();
  for (const row of html.matchAll(/<tr[^>]*>([\s\S]*?)<\/tr>/g)) {
    const body = row[1];
    const labelMatch = body.match(/<td[^>]*>([\s\S]*?)<\/td>/);
    if (!labelMatch) continue;
    const label = stripTags(labelMatch[1]);
    if (!label) continue;
    const valueMatch = body.match(/class="first_currency"[^>]*>([\s\S]*?)<\/span>/);
    if (!valueMatch) continue;
    if (!fields.has(label)) fields.set(label, decodeEntities(valueMatch[1]));
  }

  const pick = (...labels) => {
    for (const l of labels) if (fields.has(l)) return toNumber(fields.get(l));
    return null;
  };

  // Summary sentence: "The estimated monthly costs for a single person are $1,011.9 ..."
  const singleMatch = html.match(
    /estimated monthly costs for a single person are[\s\S]{0,120}?emp_number">([\s\S]*?)<(?:span|)/i
  );
  const familyMatch = html.match(
    /estimated monthly costs for a family of four are[\s\S]{0,120}?emp_number">([\s\S]*?)<(?:span|)/i
  );

  const rec = {
    city: inCity || null,
    sourceUrl: url,
    dataDate,
    rent: {
      oneBedCentre: pick("1 Bedroom Apartment in City Centre", "Apartment (1 bedroom) in City Centre"),
      oneBedOutside: pick(
        "1 Bedroom Apartment Outside of City Centre",
        "Apartment (1 bedroom) Outside of Centre"
      ),
      threeBedCentre: pick(
        "3 Bedroom Apartment in City Centre",
        "Apartment (3 bedrooms) in City Centre"
      ),
      threeBedOutside: pick(
        "3 Bedroom Apartment Outside of City Centre",
        "Apartment (3 bedrooms) Outside of Centre"
      ),
    },
    salary: pick("Average Monthly Net Salary (After Tax)"),
    singleExpenses: singleMatch ? toNumber(singleMatch[1]) : null,
    family4Expenses: familyMatch ? toNumber(familyMatch[1]) : null,
  };

  const hasAny =
    rec.salary != null ||
    rec.singleExpenses != null ||
    Object.values(rec.rent).some((v) => v != null);

  return { ...rec, hasData: hasAny };
}

/**
 * "Cost of Living Index by City" ranking table: one row per ranked city with
 * its indices. Cheaper than scraping index pages one by one.
 */
export function parseRankings(html) {
  const rows = [];
  for (const row of html.matchAll(/<tr[^>]*>([\s\S]*?)<\/tr>/g)) {
    const cells = [...row[1].matchAll(/<td[^>]*>([\s\S]*?)<\/td>/g)].map((c) => c[1]);
    if (cells.length < 7) continue;
    const link = (cells[1].match(/cost-of-living\/in\/([^"?#]+)/) || [])[1];
    const name = stripTags(cells[1]);
    if (!name) continue;
    const rec = {
      rank: toNumber(stripTags(cells[0])),
      name,
      slug: link ? decodeURIComponent(link) : null,
      coli: toNumber(stripTags(cells[2])),
      rentIndex: toNumber(stripTags(cells[3])),
      colRentIndex: toNumber(stripTags(cells[4])),
      groceriesIndex: toNumber(stripTags(cells[5])),
      restaurantIndex: toNumber(stripTags(cells[6])),
      purchasingPowerIndex: cells[7] != null ? toNumber(stripTags(cells[7])) : null,
    };
    if (rec.coli != null || rec.rentIndex != null) rows.push(rec);
  }
  return rows;
}

/** Pull a "City, Country" out of a rankings row name like "Hamilton, Bermuda". */
export function splitCityCountry(name) {
  const i = name.lastIndexOf(",");
  if (i === -1) return { city: name.trim(), country: null };
  return { city: name.slice(0, i).trim(), country: name.slice(i + 1).trim() };
}
