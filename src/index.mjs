/* @waronsaas/scanner: scan a website for what AI assistants and search engines can read.
     import { scan, explain, toText } from '@waronsaas/scanner';
     const r = await scan('example.com');
     console.log(toText(r)); */
export { scan, draftLlms, readPage, readRobots, pagespeed, hostOf, slugOf, publicHost } from './scan.mjs';
export { CHECKS, AREA_SHARE, AREA_NAME, AREA_ABOUT, VERDICTS } from './checks.mjs';
export { explain, brief, compare, toText, meaning, areas, fixes, verdictOf, AREAS } from './report.mjs';
export { USER_AGENT } from './net.mjs';
