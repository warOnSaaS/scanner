/* Every check the scan runs: what it means and how to fix it, in plain words.
   One source, read by the report page, the CLI, the API and the MCP tools.

   AREA_SHARE is each area's share of the overall grade. Inside an area, each check
   carries a weight (set in scan.mjs); the area's score is the weighted share it passed. */
export const AREA_SHARE = { agents: 0.4, search: 0.25, performance: 0.25, hygiene: 0.1 };
export const AREA_NAME = { agents: "What AI assistants can read", search: "Search basics", performance: "Speed", hygiene: "Security basics" };
export const CHECKS = {
 "A file assistants can read": {
  "why": "A plain summary of the site at /llms.txt. Cheap to add. Evidence that AI tools read it is still mixed.",
  "how": "Publish a plain-text summary at /llms.txt: what you do, your key pages, how to reach you. The draft below is a start."
 },
 "A sitemap to crawl": {
  "why": "A list of every page, so crawlers find all of them, not just what the menu links to.",
  "how": "Publish /sitemap.xml listing every public page, and reference it in robots.txt."
 },
 "Accessibility": {
  "why": "Whether people using screen readers and keyboards can use the site.",
  "how": "Fix the issues Lighthouse lists: contrast, labels, headings, keyboard focus."
 },
 "Assistants are allowed in": {
  "why": "If robots.txt blocks AI crawlers by name, assistants answer about you from other people's pages.",
  "how": "Remove the lines in robots.txt that disallow GPTBot, ClaudeBot, PerplexityBot and similar crawlers."
 },
 "Canonical URL": {
  "why": "Tells search engines which address is the real one, so duplicates do not split the ranking.",
  "how": "Add a canonical link tag pointing at the page's own preferred address."
 },
 "Content Security Policy": {
  "why": "Limits which scripts can run on the page, which blocks a common kind of attack.",
  "how": "Send a Content-Security-Policy header that lists where scripts may load from."
 },
 "Enough text to rank on": {
  "why": "Search engines and assistants need words to understand a page. Images and video alone do not count.",
  "how": "Add a few hundred words of real copy about what you offer."
 },
 "Google PageSpeed, mobile": {
  "why": "Google's own speed test on a phone. Speed affects ranking and how many visitors stay.",
  "how": "Usually the fixes above: fewer outside scripts, lighter images, faster server."
 },
 "HSTS": {
  "why": "Tells browsers to always use the encrypted connection.",
  "how": "Send a Strict-Transport-Security header."
 },
 "HTML weight": {
  "why": "A heavy page takes longer to arrive, especially on a phone.",
  "how": "Remove inline bloat (large embedded scripts, styles and data) from the HTML."
 },
 "HTTPS": {
  "why": "An encrypted connection. Browsers warn visitors away from sites without it.",
  "how": "Serve every page over HTTPS and redirect plain HTTP to it."
 },
 "Images described": {
  "why": "Alt text describes images for screen readers and for search.",
  "how": "Give every meaningful image alt text that says what it shows."
 },
 "Internal links": {
  "why": "Links between your own pages help crawlers find and weigh them.",
  "how": "Link from the home page to your main sections with plain, descriptive link text."
 },
 "Language declared": {
  "why": "Tells browsers, screen readers and search engines what language the page is in.",
  "how": "Set the lang attribute on the html tag, for example lang=\"en\"."
 },
 "MIME sniffing off": {
  "why": "A one-line header that stops browsers guessing file types, a small security gap.",
  "how": "Send the header X-Content-Type-Options: nosniff."
 },
 "Meta description": {
  "why": "The summary under the headline in search. Too long and it gets cut off.",
  "how": "Write a description of about 150 characters that a person would click on."
 },
 "Mobile viewport": {
  "why": "Without it, the page shows as a shrunken desktop page on a phone.",
  "how": "Add <meta name=\"viewport\" content=\"width=device-width, initial-scale=1\">."
 },
 "Modern image formats": {
  "why": "WebP and AVIF images are much lighter than JPEG and PNG at the same quality.",
  "how": "Serve WebP or AVIF images, with JPEG or PNG only as a fallback."
 },
 "Nothing pretending to be an answer": {
  "why": "Some sites return a normal web page where the file should be. An assistant reads that as broken.",
  "how": "Make /llms.txt return the text file itself with a 200 status, not your site's normal page or a redirect."
 },
 "One H1": {
  "why": "One main heading tells search engines what the page is about.",
  "how": "Use exactly one main heading per page, and make it say what the page is about."
 },
 "Render-blocking scripts": {
  "why": "Scripts that stop the page from showing until they load.",
  "how": "Add defer or async to scripts, or move them to the end of the page."
 },
 "Server response": {
  "why": "How long the server takes to start sending the page. Slow starts slow everything.",
  "how": "Cache the HTML at the edge or speed up the server so the first byte arrives in under about 600 ms."
 },
 "Social card": {
  "why": "Controls the preview image and title when the page is shared or linked.",
  "how": "Add og:title, og:description and og:image tags."
 },
 "Structured data that parses": {
  "why": "Machine-readable facts (name, products, prices, hours) that search engines and assistants can quote exactly.",
  "how": "Add a JSON-LD block for your organization, and for products, locations or articles where you have them. Validate it with Google's Rich Results Test."
 },
 "The words are in the page": {
  "why": "If the text only appears after scripts run, many crawlers and assistants see an empty page.",
  "how": "Render the main text on the server (or pre-render it) so it is in the HTML before any script runs."
 },
 "Third-party code": {
  "why": "Every outside script is something you do not control that slows the page down.",
  "how": "Remove or delay outside scripts you do not need on first load: chat widgets, tag managers, trackers."
 },
 "Title and H1 agree": {
  "why": "When the title and the main heading share words, the page states its subject twice.",
  "how": "Use the same key words in the title and in the main heading."
 },
 "Title matches the page": {
  "why": "A title that names what the page is mostly about ranks better and gets quoted correctly.",
  "how": "Put the words the page is actually about into the title."
 },
 "Title tag": {
  "why": "The title is the headline in search results and the first thing an assistant reads.",
  "how": "Write a unique title of about 50 to 60 characters that says what the page is."
 }
};

/* One line on each area, for the page that explains the scan. */
export const AREA_ABOUT = {
  agents: 'Whether ChatGPT, Claude, Perplexity and the like can read the site and quote it correctly.',
  search: 'The basics a search engine reads first: title, description, headings and links.',
  performance: 'How much the page costs to load, and Google\'s own speed test on a phone when it is available.',
  hygiene: 'Encryption, a few security headers, language and phone layout.',
};

/* The headline verdict, from the agents area. [label, what it means, tone] */
export const VERDICTS = {
  yes: ['Built for assistants', 'This site publishes something an assistant can read directly and quote from.', 'good'],
  fake: ['Looks ready, is not', 'A file exists at the right address but returns a web page rather than content. An assistant gets nothing usable from it.', 'warn'],
  blocked: ['Blocked by robots.txt', 'AI crawlers are turned away by name. This is the one case where an assistant genuinely cannot read the site, and the question still gets answered, from somewhere else.', 'bad'],
  unreadable: ['Needs JavaScript', 'Almost nothing is in the served HTML. A crawler that does not run scripts sees an empty page.', 'bad'],
  none: ['Nothing built for assistants', 'An assistant can still read the page like any other. What is missing is anything written to be quoted, so answers about this company get assembled from whatever else is readable.', 'bad'],
  unreachable: ['Could not be reached', 'The site did not answer, or it turned the scanner away. Some sites block automated visitors, especially from cloud servers.', 'bad'],
};
