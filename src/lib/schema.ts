/**
 * JSON-LD builders — what search engines and AI assistants actually read.
 *
 * A crawler does not see the page's layout; it sees this. Every claim the shop
 * makes on screen — the price, the stock, the star rating, which boutique sells
 * it and where that boutique is — has to be restated here as data, or it is
 * invisible to a rich result and to any model summarising the catalogue.
 *
 * Rules this module holds to, because Google's validator is unforgiving:
 *   · never emit a field we don't actually have (an empty `Offer.price` is a
 *     hard error, and a wrong `AggregateRating` is a manual-action risk)
 *   · `aggregateRating` only when there is at least one real review — the
 *     single most common cause of a "Review snippet" penalty
 *   · absolute URLs everywhere; `@id` values that are stable page URLs, so the
 *     graph joins up across pages
 *
 * The edge middleware emits the same shapes server-side for crawlers that never
 * run JavaScript. Keep the two in step.
 */

import { COMPANY } from '@/data/company';
import { SITE_NAME, SITE_URL, absoluteUrl, canonicalUrl, routes } from '@/lib/seo';
import type { Boutique, Product } from '@/data/demo';

export type JsonLd = Record<string, unknown>;

/** Drop null/undefined/empty keys — a partial schema is fine, a hollow one is not. */
function compact<T extends JsonLd>(obj: T): T {
  const out = {} as T;
  for (const [k, v] of Object.entries(obj)) {
    if (v === null || v === undefined || v === '' ) continue;
    if (Array.isArray(v) && v.length === 0) continue;
    (out as JsonLd)[k] = v;
  }
  return out;
}

/* ── Site-wide ──────────────────────────────────────────────────────────── */

/**
 * The publisher. Emitted on every page so the entity is unambiguous, and
 * referenced by `@id` from products and breadcrumbs rather than repeated.
 */
export function organizationSchema(): JsonLd {
  return compact({
    '@type': 'Organization',
    '@id': `${SITE_URL}/#organization`,
    /*
     * The trading name, not `COMPANY.legalName`.
     *
     * Two things were wrong with using the legal name here. It is still a TODO
     * placeholder in src/data/company.ts, so this published an unverified
     * registered-entity claim as structured data; and the edge middleware emits
     * `name: "MangaiMart"` on this exact same `@id`, so the two nodes merged
     * into one entity asserting two different names. The brand a shopper types
     * is the one that has to win, and `legalName` is deliberately not emitted
     * until the real incorporated entity is confirmed.
     */
    name: SITE_NAME,
    // Mirrors BRAND_ALTERNATE_NAMES in middleware.js — change both together.
    // "Mangai Mart" as two words is a real share of own-brand search and had
    // nothing anywhere tying that spelling to this domain.
    alternateName: ['Mangai Mart', 'MangaiMart Boutique', 'MangaiMart India'],
    url: SITE_URL,
    logo: {
      '@type': 'ImageObject',
      url: absoluteUrl('/mangaimart-logo.png'),
      caption: SITE_NAME,
    },
    description: COMPANY.description,
    email: COMPANY.email,
    telephone: COMPANY.phone,
    foundingDate: String(COMPANY.foundedYear),
    address: {
      '@type': 'PostalAddress',
      streetAddress: [COMPANY.address.line1, COMPANY.address.line2].filter(Boolean).join(', '),
      addressLocality: COMPANY.address.city,
      addressRegion: COMPANY.address.state,
      postalCode: COMPANY.address.pincode,
      addressCountry: 'IN',
    },
    contactPoint: [
      compact({
        '@type': 'ContactPoint',
        contactType: 'customer support',
        telephone: COMPANY.phone,
        email: COMPANY.supportEmail,
        areaServed: 'IN',
        availableLanguage: ['en', 'ta'],
      }),
    ],
    sameAs: [
      COMPANY.social.instagram,
      COMPANY.social.facebook,
      COMPANY.social.youtube,
    ].filter(Boolean),
  });
}

/**
 * The site itself, plus the search box Google can render directly in a result
 * ("sitelinks searchbox"). `/search?q=` is a real route, so the action is
 * honest rather than decorative.
 */
export function websiteSchema(): JsonLd {
  return {
    '@type': 'WebSite',
    '@id': `${SITE_URL}/#website`,
    url: SITE_URL,
    name: SITE_NAME,
    description: COMPANY.description,
    inLanguage: 'en-IN',
    publisher: { '@id': `${SITE_URL}/#organization` },
    potentialAction: {
      '@type': 'SearchAction',
      target: {
        '@type': 'EntryPoint',
        urlTemplate: `${SITE_URL}/search?q={search_term_string}`,
      },
      'query-input': 'required name=search_term_string',
    },
  };
}

/* ── Navigation ─────────────────────────────────────────────────────────── */

export type Crumb = { name: string; path: string };

/**
 * The breadcrumb trail Google prints instead of a raw URL in a result.
 * The final crumb is the current page and intentionally carries no `item`.
 */
export function breadcrumbSchema(crumbs: Crumb[]): JsonLd | null {
  if (!crumbs.length) return null;
  return {
    '@type': 'BreadcrumbList',
    itemListElement: crumbs.map((c, i) => compact({
      '@type': 'ListItem',
      position: i + 1,
      name: c.name,
      item: i === crumbs.length - 1 ? undefined : absoluteUrl(c.path),
    })),
  };
}

/* ── Product ────────────────────────────────────────────────────────────── */

/** Stock count → the schema.org availability the buyer actually faces. */
function availabilityOf(stock: number): string {
  if (stock <= 0) return 'https://schema.org/OutOfStock';
  if (stock <= 5) return 'https://schema.org/LimitedAvailability';
  return 'https://schema.org/InStock';
}

/**
 * A product, its offer, and its rating.
 *
 * `priceValidUntil` is required by Google for a Merchant listing; a rolling
 * one-year horizon is the accepted convention for an always-on catalogue.
 */
export function productSchema(
  product: Product,
  opts: { boutique?: Boutique; reviews?: { author: string; rating: number; body?: string; createdAt?: string }[] } = {},
): JsonLd {
  const { boutique, reviews } = opts;
  const url = absoluteUrl(routes.product(product));
  const images = [product.image, ...(product.images ?? [])]
    .filter(Boolean)
    .map((src) => absoluteUrl(src))
    .slice(0, 8);

  const validUntil = new Date(Date.now() + 365 * 24 * 60 * 60 * 1000).toISOString().slice(0, 10);

  return compact({
    '@type': 'Product',
    '@id': `${url}#product`,
    name: product.title,
    url,
    image: images,
    description:
      product.description?.trim() ||
      `${product.title} — ${product.fabric || 'ethnic wear'} in ${product.color || 'assorted colours'}, from ${product.boutique}, ${product.city}.`,
    sku: product.id,
    mpn: product.id,
    category: product.cat,
    color: product.color || undefined,
    material: product.fabric || undefined,
    size: product.sizes?.length ? product.sizes : undefined,
    // The boutique is the brand a shopper is actually buying from.
    brand: { '@type': 'Brand', name: product.boutique },
    ...(boutique
      ? { manufacturer: { '@id': `${absoluteUrl(routes.boutique(boutique))}#boutique` } }
      : null),
    offers: compact({
      '@type': 'Offer',
      '@id': `${url}#offer`,
      url,
      price: product.price,
      priceCurrency: 'INR',
      priceValidUntil: validUntil,
      availability: availabilityOf(product.stock),
      itemCondition: 'https://schema.org/NewCondition',
      seller: boutique
        ? { '@type': 'Organization', name: boutique.name }
        : { '@id': `${SITE_URL}/#organization` },
      hasMerchantReturnPolicy: {
        '@type': 'MerchantReturnPolicy',
        applicableCountry: 'IN',
        returnPolicyCategory: 'https://schema.org/MerchantReturnFiniteReturnWindow',
        merchantReturnDays: 7,
        returnMethod: 'https://schema.org/ReturnByMail',
        returnFees: 'https://schema.org/FreeReturn',
      },
      shippingDetails: {
        '@type': 'OfferShippingDetails',
        shippingDestination: { '@type': 'DefinedRegion', addressCountry: 'IN' },
        deliveryTime: {
          '@type': 'ShippingDeliveryTime',
          handlingTime: { '@type': 'QuantitativeValue', minValue: 1, maxValue: 2, unitCode: 'DAY' },
          transitTime: { '@type': 'QuantitativeValue', minValue: 2, maxValue: 7, unitCode: 'DAY' },
        },
      },
    }),
    // Only when it is real. A fabricated rating is a manual-action risk.
    aggregateRating:
      product.reviews > 0 && product.rating > 0
        ? {
            '@type': 'AggregateRating',
            ratingValue: Number(product.rating.toFixed(1)),
            reviewCount: product.reviews,
            bestRating: 5,
            worstRating: 1,
          }
        : undefined,
    review: reviews?.length
      ? reviews.slice(0, 5).map((r) => compact({
          '@type': 'Review',
          author: { '@type': 'Person', name: r.author },
          datePublished: r.createdAt?.slice(0, 10),
          reviewBody: r.body,
          reviewRating: {
            '@type': 'Rating',
            ratingValue: r.rating,
            bestRating: 5,
            worstRating: 1,
          },
        }))
      : undefined,
  });
}

/* ── Boutique ───────────────────────────────────────────────────────────── */

/**
 * A boutique is a real shop in a real town, so it is marked up as a
 * `ClothingStore` (a `LocalBusiness`) rather than a generic seller. This is
 * what makes "boutiques in Coimbatore" a query the site can win.
 */
export function boutiqueSchema(boutique: Boutique, productCount?: number): JsonLd {
  const url = absoluteUrl(routes.boutique(boutique));
  return compact({
    '@type': 'ClothingStore',
    '@id': `${url}#boutique`,
    name: boutique.name,
    url,
    image: boutique.image ? absoluteUrl(boutique.image) : undefined,
    logo: boutique.logo ? absoluteUrl(boutique.logo) : undefined,
    description:
      boutique.desc?.trim() ||
      `${boutique.name} is a verified boutique in ${boutique.city}, selling ethnic wear on ${SITE_NAME}.`,
    telephone: boutique.phone || undefined,
    address: compact({
      '@type': 'PostalAddress',
      streetAddress: boutique.area || undefined,
      addressLocality: boutique.city,
      // No addressRegion: sellers are no longer assumed to be in one state, and
      // `compact` drops the key rather than emitting a wrong one. Mirrors the
      // same decision in middleware.js.
      addressCountry: 'IN',
    }),
    areaServed: { '@type': 'Country', name: 'India' },
    currenciesAccepted: 'INR',
    paymentAccepted: 'UPI, Credit Card, Debit Card, Net Banking',
    foundingDate: boutique.since ? String(boutique.since) : undefined,
    hasMap: boutique.mapUrl || undefined,
    parentOrganization: { '@id': `${SITE_URL}/#organization` },
    sameAs: boutique.insta
      ? [boutique.insta.startsWith('http') ? boutique.insta : `https://instagram.com/${boutique.insta.replace(/^@/, '')}`]
      : undefined,
    aggregateRating:
      boutique.reviews > 0 && boutique.rating > 0
        ? {
            '@type': 'AggregateRating',
            ratingValue: Number(boutique.rating.toFixed(1)),
            reviewCount: boutique.reviews,
            bestRating: 5,
            worstRating: 1,
          }
        : undefined,
    /*
     * The count only, as a count.
     *
     * This used to be `makesOffer` with `itemOffered: { Product, name: "12
     * pieces" }` — which asserts that the shop sells a product called "12
     * pieces". The edge middleware emits the real catalogue (an `OfferCatalog`
     * of actual titles and URLs) on the same `@id`, so the two graphs merge and
     * that phantom product merged in with them.
     */
    hasOfferCatalog: productCount
      ? { '@type': 'OfferCatalog', name: `${boutique.name} catalogue`, numberOfItems: productCount }
      : undefined,
  });
}

/* ── Listing pages ──────────────────────────────────────────────────────── */

/**
 * A grid page: what it collects, and the first N items in order. The `ItemList`
 * is what lets Google understand a category page as a set of products rather
 * than a wall of links.
 */
export function collectionSchema(opts: {
  name: string;
  description: string;
  path: string;
  items: Product[];
  totalCount?: number;
}): JsonLd {
  const { name, description, path, items, totalCount } = opts;
  const url = canonicalUrl(path);
  return {
    '@type': 'CollectionPage',
    '@id': `${url}#collection`,
    name,
    description,
    url,
    isPartOf: { '@id': `${SITE_URL}/#website` },
    inLanguage: 'en-IN',
    mainEntity: {
      '@type': 'ItemList',
      numberOfItems: totalCount ?? items.length,
      itemListElement: items.slice(0, 30).map((p, i) => ({
        '@type': 'ListItem',
        position: i + 1,
        url: absoluteUrl(routes.product(p)),
        name: p.title,
      })),
    },
  };
}

/** The same, for a page listing shops rather than pieces. */
export function boutiqueListSchema(opts: {
  name: string;
  description: string;
  path: string;
  boutiques: Boutique[];
}): JsonLd {
  const { name, description, path, boutiques } = opts;
  const url = canonicalUrl(path);
  return {
    '@type': 'CollectionPage',
    '@id': `${url}#collection`,
    name,
    description,
    url,
    isPartOf: { '@id': `${SITE_URL}/#website` },
    inLanguage: 'en-IN',
    mainEntity: {
      '@type': 'ItemList',
      numberOfItems: boutiques.length,
      itemListElement: boutiques.slice(0, 30).map((b, i) => ({
        '@type': 'ListItem',
        position: i + 1,
        url: absoluteUrl(routes.boutique(b)),
        name: b.name,
      })),
    },
  };
}

/* ── Content pages ──────────────────────────────────────────────────────── */

export function faqSchema(faqs: { q: string; a: string }[]): JsonLd | null {
  if (!faqs.length) return null;
  return {
    '@type': 'FAQPage',
    mainEntity: faqs.map((f) => ({
      '@type': 'Question',
      name: f.q,
      acceptedAnswer: { '@type': 'Answer', text: f.a },
    })),
  };
}

/** Policy, About and Help pages — real documents, not storefront surfaces. */
export function articleSchema(opts: {
  title: string;
  description: string;
  path: string;
  updated?: string;
}): JsonLd {
  const url = canonicalUrl(opts.path);
  return compact({
    '@type': 'WebPage',
    '@id': `${url}#webpage`,
    name: opts.title,
    headline: opts.title,
    description: opts.description,
    url,
    inLanguage: 'en-IN',
    isPartOf: { '@id': `${SITE_URL}/#website` },
    publisher: { '@id': `${SITE_URL}/#organization` },
    dateModified: opts.updated,
  });
}

/* ── Assembly ───────────────────────────────────────────────────────────── */

/**
 * Wrap a set of nodes into one `@graph` document.
 *
 * One graph rather than several loose `<script>` blocks is what lets `@id`
 * references resolve — a product can point at its boutique, and the boutique at
 * the organisation, instead of each repeating the others in full.
 */
export function graph(...nodes: (JsonLd | null | undefined)[]): JsonLd {
  return {
    '@context': 'https://schema.org',
    '@graph': nodes.filter(Boolean) as JsonLd[],
  };
}
