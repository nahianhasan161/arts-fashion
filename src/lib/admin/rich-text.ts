/**
 * Server-side sanitisation for product descriptions.
 *
 * The editor in the browser restricts what a person can produce, but the
 * browser is not the trust boundary: the route accepts a POST from anything
 * that can present a session, and the description is rendered on storefront
 * pages. So the same allow-list is applied here, on the way in, and the result
 * is what gets stored.
 *
 * The list below is deliberately short. It is an allow-list, so a tag that is
 * not named is removed, which means a new StarterKit release cannot widen what
 * is stored without a review here.
 */

/** Tags kept, with the attributes each may carry. */
const ALLOWED: Record<string, readonly string[]> = {
  p: [],
  br: [],
  strong: [],
  b: [],
  em: [],
  i: [],
  u: [],
  s: [],
  strike: [],
  del: [],
  ul: [],
  ol: [],
  li: [],
  a: ["href", "title", "rel", "target"],
};

const VOID_TAGS = new Set(["br"]);

/**
 * Anything not matching this is dropped: a tag, an attribute name, or the
 * text after a stray "<" that never became a tag.
 */
const TAG_NAME = /^[a-z][a-z0-9]*$/;
const ATTR_NAME = /^[a-z][a-z0-9-]*$/;

/** Schemes permitted in href. Plain http(s) and mailto; no javascript:, no data:. */
const SAFE_SCHEME = /^(https?:\/\/|mailto:|tel:|\/|#|\.\/|\.\.\/)/i;

function escapeText(value: string): string {
  return value.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
}

/**
 * Rebuilds a link's attributes, keeping the href only when its scheme is safe
 * and forcing rel="noopener noreferrer" on any link that opens a new tab.
 *
 * target is honoured only for _blank, which is the only value that hands
 * window.opener to the destination, and the rel is then made to match rather
 * than trusted from the input.
 */
function safeAttrs(tag: string, raw: string): string {
  if (tag !== "a") return "";

  const attrs = new Map<string, string>();
  for (const pair of raw.split(/\s+/)) {
    if (!pair) continue;
    const eq = pair.indexOf("=");
    if (eq < 0) continue;
    const name = pair.slice(0, eq).toLowerCase();
    let value = pair.slice(eq + 1);
    if ((value.startsWith('"') && value.endsWith('"')) || (value.startsWith("'") && value.endsWith("'"))) {
      value = value.slice(1, -1);
    }
    if (ATTR_NAME.test(name) && ALLOWED.a.includes(name)) attrs.set(name, value);
  }

  const href = attrs.get("href");
  if (!href) return "";
  const trimmed = href.trim();
  // A scheme is rejected unless the whole value is one of the safe forms.
  // Anchored at the start, so "javascript:alert(1)" and a leading tab or
  // newline variant are both caught, and "/foo" still passes.
  if (/^[a-z][a-z0-9+.-]*:/i.test(trimmed) && !SAFE_SCHEME.test(trimmed)) return "";

  const out = [`href="${escapeText(trimmed)}"`];
  if (attrs.get("title")) out.push(`title="${escapeText(attrs.get("title")!)}"`);
  if (attrs.get("target") === "_blank") {
    out.push('target="_blank"');
    out.push('rel="noopener noreferrer"');
  } else if (attrs.get("rel")) {
    out.push(`rel="${escapeText(attrs.get("rel")!)}"`);
  }
  return ` ${out.join(" ")}`;
}

/**
 * Removes any open element left dangling by the input, closing what is still
 * open when the string ends. The editor only ever emits balanced markup, so an
 * unbalanced result means the input did not come from the editor, and a
 * truncated <a> is worse to store than a dropped one.
 */
function closeDangling(stack: string[]): string {
  return stack.reverse().map((tag) => `</${tag}>`).join("");
}

/**
 * Returns the description HTML reduced to the allow-list, with tags balanced
 * and text escaped.
 */
export function sanitizeProductHtml(input: string | null | undefined): string {
  if (!input) return "";

  // Anything outside the first and last angle brackets is text and is escaped
  // rather than parsed, so a description that is not HTML at all survives as
  // readable text instead of being discarded.
  const stack: string[] = [];
  const out: string[] = [];
  let i = 0;

  while (i < input.length) {
    const lt = input.indexOf("<", i);
    if (lt < 0) {
      out.push(escapeText(input.slice(i)));
      break;
    }
    if (lt > i) out.push(escapeText(input.slice(i, lt)));

    // Comments and doctype declarations are dropped whole, including
    // anything they might contain.
    if (input.startsWith("<!--", lt)) {
      const end = input.indexOf("-->", lt + 4);
      i = end < 0 ? input.length : end + 3;
      continue;
    }
    if (input.startsWith("<!", lt) || input.startsWith("<?", lt)) {
      const end = input.indexOf(">", lt + 2);
      i = end < 0 ? input.length : end + 1;
      continue;
    }

    const gt = input.indexOf(">", lt);
    if (gt < 0) {
      // An unterminated "<" is text, not a tag.
      out.push("&lt;");
      i = lt + 1;
      continue;
    }

    const inner = input.slice(lt + 1, gt).trim();
    i = gt + 1;

    const isClose = inner.startsWith("/");
    const name = (isClose ? inner.slice(1) : inner.split(/\s+/)[0] ?? "").toLowerCase().replace(/[^a-z0-9]/g, "");
    if (!TAG_NAME.test(name) || !(name in ALLOWED)) {
      // script and style hold text that is not prose: a browser treats their
      // contents as code or as a stylesheet, never as something to display.
      // Dropping only the tags would leave "alert(1)" sitting in the
      // description as visible text, so the whole element goes.
      if (name === "script" || name === "style") {
        const end = input.toLowerCase().indexOf(`</${name}>`, i);
        i = end < 0 ? input.length : end + name.length + 3;
      }
      continue;
    }

    if (isClose) {
      const at = stack.lastIndexOf(name);
      if (at < 0) continue; // A close with no open is dropped.
      // Close everything opened inside it, so input such as <a><p>x</a>
      // balances rather than leaving a <p> open.
      out.push(closeDangling(stack.slice(at + 1)));
      stack.length = at;
      out.push(`</${name}>`);
      continue;
    }

    if (stack.includes(name)) {
      // Overlapping, rather than nested, tags are rewritten to their close-then
      // open form: <b>a<i>b</b>c</i> becomes <b>a<i>b</i></b><i>c</i>.
      const at = stack.lastIndexOf(name);
      out.push(closeDangling(stack.slice(at)));
      stack.length = at;
    }
    stack.push(name);

    const selfClosing = inner.endsWith("/") || VOID_TAGS.has(name);
    out.push(selfClosing ? `<${name}/>` : `<${name}${safeAttrs(name, inner)}>`);
    if (selfClosing) stack.pop();
  }

  out.push(closeDangling(stack));
  return out.join("").replace(/<p><\/p>/g, "");
}
